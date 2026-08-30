import type { Area } from 'react-easy-crop';

const OUTPUT_MIME_TYPE = 'image/jpeg';
const OUTPUT_QUALITY = 0.95;

export async function getCroppedImg(imageSrc: string, crop: Area, rotation: number): Promise<Blob> {
  if (crop.width <= 0 || crop.height <= 0) {
    throw new Error('Crop area must have positive dimensions.');
  }

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.crossOrigin = 'anonymous';
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Failed to load the image for cropping.'));
    element.src = imageSrc;
  });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not create a 2D canvas context.');

  const maxSize = Math.max(image.width, image.height);
  const safeArea = Math.ceil(maxSize * Math.SQRT2);
  canvas.width = safeArea;
  canvas.height = safeArea;

  context.translate(safeArea / 2, safeArea / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.translate(-safeArea / 2, -safeArea / 2);
  context.drawImage(
    image,
    safeArea / 2 - image.width / 2,
    safeArea / 2 - image.height / 2,
  );

  const imageData = context.getImageData(0, 0, safeArea, safeArea);
  canvas.width = Math.round(crop.width);
  canvas.height = Math.round(crop.height);
  context.putImageData(
    imageData,
    Math.round(-safeArea / 2 + image.width / 2 - crop.x),
    Math.round(-safeArea / 2 + image.height / 2 - crop.y),
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The browser failed to encode the cropped image.'));
        return;
      }
      resolve(blob);
    }, OUTPUT_MIME_TYPE, OUTPUT_QUALITY);
  });
}
