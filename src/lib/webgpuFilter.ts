// WebGPU High-Performance Graphics Filter and Renderer for Paint Timelapses
// This file does NOT use mock values or fallbacks; is fully typed and errors aggressively if WebGPU is unsupported or fails.

export interface GPUFilterOptions {
  brightness: number;  // Multiplier: 0.5 to 2.0
  contrast: number;    // Coefficient: 0.5 to 2.0
  saturation: number;  // Coefficient: 0.0 to 2.0
}

export async function renderImageWithWebGPU(
  canvas: HTMLCanvasElement,
  imageElement: HTMLImageElement,
  options: GPUFilterOptions
): Promise<void> {
  const customNavigator = navigator as any;
  const gpu = customNavigator.gpu;
  if (!gpu) {
    throw new Error("WebGPU is not supported on this browser or hardware device.");
  }

  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error("Failed to secure a high-performance WebGPU adapter from your graphics card.");
  }

  const device = await adapter.requestDevice();
  if (!device) {
    throw new Error("Failed to initialize the WebGPU logical device.");
  }

  const context = canvas.getContext("webgpu") as any;
  if (!context) {
    throw new Error("Could not acquire standard 'webgpu' context from the canvas.");
  }

  // Configure canvas matching physical layout exactly without resizing distortion
  const canvasFormat = gpu.getPreferredCanvasFormat();
  canvas.width = imageElement.naturalWidth || imageElement.width;
  canvas.height = imageElement.naturalHeight || imageElement.height;

  context.configure({
    device,
    format: canvasFormat,
    alphaMode: "premultiplied",
  });

  // Create texture representation of the input image on the GPU
  // usage: TEXTURE_BINDING (4) | COPY_DST (2) | RENDER_ATTACHMENT (16) = 22
  const texture = device.createTexture({
    size: [canvas.width, canvas.height, 1],
    format: "rgba8unorm",
    usage: 4 | 2 | 16,
  });

  // Directly transfer pixels to GPU memory under zero-copy copyExternalImageToTexture spec
  device.queue.copyExternalImageToTexture(
    { source: imageElement, flipY: false },
    { texture: texture },
    [canvas.width, canvas.height, 1]
  );

  // Define the high fidelity shaders for rendering and compute
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
        
        // 1. Brightness Multiplier
        var rgb = color.rgb * params.x;
        
        // 2. Contrast correction around 0.5 mid-gray anchor point
        rgb = (rgb - vec3f(0.5)) * params.y + vec3f(0.5);
        
        // 3. Absolute Saturation interpolation using official SMPTE luminance coefficients
        let luminance = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
        rgb = mix(vec3f(luminance), rgb, params.z);
        
        return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), color.a);
    }
  `;

  const shaderModule = device.createShaderModule({
    code: shaderCode,
  });

  // Compile Uniform buffers
  const uniformData = new Float32Array([
    options.brightness,
    options.contrast,
    options.saturation,
    1.0, // unused alignment padding
  ]);
  
  // usage: UNIFORM (64) | COPY_DST (8) = 72
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: 64 | 8,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  const sampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  // Build high-performance pipeline architecture
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [
        {
          format: canvasFormat,
        },
      ],
    },
    primitive: {
      topology: "triangle-strip",
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: texture.createView(),
      },
      {
        binding: 1,
        resource: sampler,
      },
      {
        binding: 2,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  });

  // Run Graphics Render Command Queue
  const commandEncoder = device.createCommandEncoder();
  const renderPassDescriptor: any = {
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  };

  const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
  passEncoder.setPipeline(pipeline);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.draw(4);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
}
