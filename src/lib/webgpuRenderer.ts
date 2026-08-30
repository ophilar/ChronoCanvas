import { WebGPUFilterOptions } from '../types';

export class WebGpuRenderer {
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private sampler: GPUSampler | null = null;
  private canvasFormat: GPUTextureFormat = 'bgra8unorm';
  private currentTexture: GPUTexture | null = null;
  private currentImageSrc: string | null = null;
  private isConfiguredForCanvas: HTMLCanvasElement | null = null;

  public async initialize(): Promise<void> {
    if (this.device && this.pipeline) return;

    const nav = navigator as any;
    if (!nav.gpu) {
      throw new Error('WebGPU is not supported by your browser or graphics hardware.');
    }

    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to obtain a high-performance WebGPU adapter.');
    }

    this.device = await adapter.requestDevice();
    if (!this.device) {
      throw new Error('Failed to initialize WebGPU logical device.');
    }

    this.canvasFormat = nav.gpu.getPreferredCanvasFormat();

    const shaderCode = `
      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) texCoords: vec2f,
      };

      @vertex
      fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        var pos = array<vec2f, 4>(
          vec2f(-1.0,  1.0),
          vec2f(-1.0, -1.0),
          vec2f( 1.0,  1.0),
          vec2f( 1.0, -1.0)
        );
        var tex = array<vec2f, 4>(
          vec2f(0.0, 0.0),
          vec2f(0.0, 1.0),
          vec2f(1.0, 0.0),
          vec2f(1.0, 1.0)
        );

        var out: VertexOutput;
        out.position = vec4f(pos[vertexIndex], 0.0, 1.0);
        out.texCoords = tex[vertexIndex];
        return out;
      }

      @group(0) @binding(0) var myTexture: texture_2d<f32>;
      @group(0) @binding(1) var mySampler: sampler;
      @group(0) @binding(2) var<uniform> params: vec4f; // x: brightness, y: contrast, z: saturation, w: unused

      @fragment
      fn fs_main(in: VertexOutput) -> @location(0) vec4f {
        var color = textureSample(myTexture, mySampler, in.texCoords);
        
        // 1. Brightness multiplier
        var rgb = color.rgb * params.x;
        
        // 2. Contrast correction around mid-gray
        rgb = (rgb - vec3f(0.5)) * params.y + vec3f(0.5);
        
        // 3. SMPTE absolute luminance saturation mix
        let luminance = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
        rgb = mix(vec3f(luminance), rgb, params.z);
        
        return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), color.a);
      }
    `;

    const shaderModule = this.device.createShaderModule({
      code: shaderCode,
    });

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    // 16 bytes: 4 float32 values (brightness, contrast, saturation, padding)
    this.uniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: this.canvasFormat,
          },
        ],
      },
      primitive: {
        topology: 'triangle-strip',
      },
    });
  }

  public async render(
    canvas: HTMLCanvasElement,
    imageElement: HTMLImageElement,
    options: WebGPUFilterOptions
  ): Promise<void> {
    await this.initialize();

    if (!this.device || !this.pipeline || !this.uniformBuffer || !this.sampler) {
      throw new Error('WebGPU pipeline is not initialized.');
    }

    const context = canvas.getContext('webgpu') as any;
    if (!context) {
      throw new Error("Could not acquire 'webgpu' context from canvas.");
    }

    const naturalWidth = imageElement.naturalWidth || imageElement.width || 800;
    const naturalHeight = imageElement.naturalHeight || imageElement.height || 600;

    if (canvas.width !== naturalWidth || canvas.height !== naturalHeight || this.isConfiguredForCanvas !== canvas) {
      canvas.width = naturalWidth;
      canvas.height = naturalHeight;
      context.configure({
        device: this.device,
        format: this.canvasFormat,
        alphaMode: 'premultiplied',
      });
      this.isConfiguredForCanvas = canvas;
    }

    // Update uniform buffer
    const uniformData = new Float32Array([
      options.brightness,
      options.contrast,
      options.saturation,
      1.0,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    // Reuse or create texture if image source or dimensions changed
    const currentSrc = imageElement.src || `${naturalWidth}x${naturalHeight}`;
    if (!this.currentTexture || this.currentImageSrc !== currentSrc) {
      if (this.currentTexture) {
        this.currentTexture.destroy();
      }
      this.currentTexture = this.device.createTexture({
        size: [canvas.width, canvas.height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.currentImageSrc = currentSrc;

      this.device.queue.copyExternalImageToTexture(
        { source: imageElement, flipY: false },
        { texture: this.currentTexture },
        [canvas.width, canvas.height, 1]
      );
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: this.currentTexture.createView(),
        },
        {
          binding: 1,
          resource: this.sampler,
        },
        {
          binding: 2,
          resource: {
            buffer: this.uniformBuffer,
          },
        },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();
    const renderPassDescriptor: any = {
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.draw(4);
    passEncoder.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  public destroy(): void {
    if (this.currentTexture) {
      this.currentTexture.destroy();
      this.currentTexture = null;
    }
    if (this.uniformBuffer) {
      this.uniformBuffer.destroy();
      this.uniformBuffer = null;
    }
    this.device = null;
    this.pipeline = null;
    this.sampler = null;
    this.isConfiguredForCanvas = null;
  }
}

// Persistent singleton instance
let rendererInstance: WebGpuRenderer | null = null;

export function getWebGpuRenderer(): WebGpuRenderer {
  if (!rendererInstance) {
    rendererInstance = new WebGpuRenderer();
  }
  return rendererInstance;
}
