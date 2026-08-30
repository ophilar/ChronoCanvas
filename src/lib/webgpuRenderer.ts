import type { WebGPUFilterOptions } from '../types';

export class WebGpuRenderer {
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private sampler: GPUSampler | null = null;
  private canvasFormat: GPUTextureFormat | null = null;
  private currentTexture: GPUTexture | null = null;
  private currentImageSrc: string | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private configuredCanvas: HTMLCanvasElement | null = null;

  public async initialize(): Promise<void> {
    if (this.device) return;
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported by this browser or graphics device.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU could not provide an adapter.');

    const device = await adapter.requestDevice();
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    const shaderModule = device.createShaderModule({ code: this.shaderCode });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const uniformBuffer = device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: canvasFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    this.device = device;
    this.canvasFormat = canvasFormat;
    this.sampler = sampler;
    this.uniformBuffer = uniformBuffer;
    this.pipeline = pipeline;

    void device.lost.then(() => {
      if (this.device === device) this.clearDeviceState();
    });
  }

  public async render(
    canvas: HTMLCanvasElement,
    imageElement: HTMLImageElement,
    options: WebGPUFilterOptions,
  ): Promise<void> {
    await this.initialize();

    const device = this.device;
    const pipeline = this.pipeline;
    const uniformBuffer = this.uniformBuffer;
    const sampler = this.sampler;
    const canvasFormat = this.canvasFormat;
    if (!device || !pipeline || !uniformBuffer || !sampler || !canvasFormat) {
      throw new Error('WebGPU initialization did not produce a complete render pipeline.');
    }

    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) throw new Error("The canvas could not provide a 'webgpu' context.");

    const width = imageElement.naturalWidth;
    const height = imageElement.naturalHeight;
    if (width <= 0 || height <= 0) throw new Error('The source image has invalid dimensions.');

    if (canvas.width !== width || canvas.height !== height || this.configuredCanvas !== canvas) {
      canvas.width = width;
      canvas.height = height;
      context.configure({ device, format: canvasFormat, alphaMode: 'premultiplied' });
      this.configuredCanvas = canvas;
    }

    device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Float32Array([options.brightness, options.contrast, options.saturation, 0]),
    );

    const imageSrc = imageElement.currentSrc || imageElement.src;
    if (!imageSrc) throw new Error('The source image has no URL.');

    if (!this.currentTexture || this.currentImageSrc !== imageSrc) {
      this.currentTexture?.destroy();
      this.currentTexture = device.createTexture({
        size: [width, height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.currentImageSrc = imageSrc;
      device.queue.copyExternalImageToTexture(
        { source: imageElement },
        { texture: this.currentTexture },
        [width, height, 1],
      );
      this.bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.currentTexture.createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: uniformBuffer } },
        ],
      });
    }

    if (!this.bindGroup) throw new Error('WebGPU texture binding was not created.');

    const commandEncoder = device.createCommandEncoder();
    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, this.bindGroup);
    passEncoder.draw(4);
    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
  }

  public destroy(): void {
    this.currentTexture?.destroy();
    this.uniformBuffer?.destroy();
    this.clearDeviceState();
  }

  private clearDeviceState(): void {
    this.device = null;
    this.pipeline = null;
    this.uniformBuffer = null;
    this.sampler = null;
    this.canvasFormat = null;
    this.currentTexture = null;
    this.currentImageSrc = null;
    this.bindGroup = null;
    this.configuredCanvas = null;
  }

  private readonly shaderCode = `
    struct VertexOutput {
      @builtin(position) position: vec4f,
      @location(0) texCoords: vec2f,
    };

    @vertex
    fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
      var positions = array<vec2f, 4>(
        vec2f(-1.0,  1.0),
        vec2f(-1.0, -1.0),
        vec2f( 1.0,  1.0),
        vec2f( 1.0, -1.0)
      );
      var coordinates = array<vec2f, 4>(
        vec2f(0.0, 0.0),
        vec2f(0.0, 1.0),
        vec2f(1.0, 0.0),
        vec2f(1.0, 1.0)
      );
      var output: VertexOutput;
      output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
      output.texCoords = coordinates[vertexIndex];
      return output;
    }

    @group(0) @binding(0) var imageTexture: texture_2d<f32>;
    @group(0) @binding(1) var imageSampler: sampler;
    @group(0) @binding(2) var<uniform> parameters: vec4f;

    @fragment
    fn fs_main(input: VertexOutput) -> @location(0) vec4f {
      let sampled = textureSample(imageTexture, imageSampler, input.texCoords);
      var rgb = sampled.rgb * parameters.x;
      rgb = (rgb - vec3f(0.5)) * parameters.y + vec3f(0.5);
      let luminance = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
      rgb = mix(vec3f(luminance), rgb, parameters.z);
      return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), sampled.a);
    }
  `;
}

let rendererInstance: WebGpuRenderer | null = null;

export function getWebGpuRenderer(): WebGpuRenderer {
  rendererInstance ??= new WebGpuRenderer();
  return rendererInstance;
}

export function destroyWebGpuRenderer(): void {
  rendererInstance?.destroy();
  rendererInstance = null;
}
