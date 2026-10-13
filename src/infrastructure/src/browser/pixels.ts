import type { RgbaImage } from '@commander-brawl/application';

/** The pixels of a loaded picture. */
export function imageToRgba(image: CanvasImageSource & { readonly width: number; readonly height: number }): RgbaImage {
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('No canvas to draw on.');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, width, height);
  return { width, height, data };
}

/** The pixels of a picture given as a data URL (a camera snapshot). */
export async function dataUrlToRgba(url: string): Promise<RgbaImage> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return imageToRgba(image);
}

/** A picture as a JPEG data URL, to show in an <img>. */
export async function rgbaToDataUrl(image: RgbaImage): Promise<string> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas to draw on.');
  context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the picture.'));
    reader.readAsDataURL(blob);
  });
}
