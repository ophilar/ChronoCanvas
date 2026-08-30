import cvModule from '@techstark/opencv-js';
import { createCanvas, loadImage } from 'canvas';
import { ImageProcessingError, RequestValidationError } from './httpErrorPolicy';

export interface CanvasBounds {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface PerspectivePoint {
  x: number;
  y: number;
}

interface CvDisposable {
  delete(): void;
}

interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type OpenCv = Awaited<typeof cvModule>;
type FeatureMatch = {
  distance: number;
  queryIdx: number;
  trainIdx: number;
};

const MAX_DECODED_IMAGE_PIXELS = 4096 * 4096;
const DETECTION_MAX_SIZE = 1000;
const ALIGNMENT_MAX_SIZE = 800;
const ALIGNMENT_MAX_FEATURES = 5000;
const ALIGNMENT_MIN_MATCHES = 10;
const ALIGNMENT_RANSAC_THRESHOLD = 5;

export function assertImageDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RequestValidationError('Decoded image dimensions must be positive integers.');
  }
  if (width * height > MAX_DECODED_IMAGE_PIXELS) {
    throw new RequestValidationError(
      `Decoded image exceeds the ${MAX_DECODED_IMAGE_PIXELS.toLocaleString('en-US')} pixel limit.`,
    );
  }
}

class CvResourceScope {
  private readonly resources: CvDisposable[] = [];

  track<T extends CvDisposable>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }

  dispose(): void {
    for (let index = this.resources.length - 1; index >= 0; index -= 1) {
      this.resources[index].delete();
    }
    this.resources.length = 0;
  }
}

function validatePerspectivePoints(points: PerspectivePoint[]): void {
  if (points.length !== 4) {
    throw new RequestValidationError('Perspective warping requires exactly 4 points.');
  }

  for (const point of points) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    ) {
      throw new RequestValidationError(
        'Perspective coordinates must be finite values in the normalized range from 0 to 1.',
      );
    }
  }
}

export class ComputerVisionService {
  private readonly cvPromise: Promise<OpenCv> = Promise.resolve(cvModule);

  private async getOpenCv(): Promise<OpenCv> {
    const cv = await this.cvPromise;
    if (typeof cv.Mat !== 'function') {
      throw new Error('OpenCV initialization completed without the Mat API.');
    }
    return cv;
  }

  async assertReady(): Promise<void> {
    await this.getOpenCv();
  }

  private processImage(
    cv: OpenCv,
    imageData: ImageDataLike,
    scope: CvResourceScope,
    maxSize: number,
  ) {
    const rawMat = scope.track(new cv.Mat(imageData.height, imageData.width, cv.CV_8UC4));
    rawMat.data.set(imageData.data);

    const scale = Math.min(1, maxSize / Math.max(rawMat.cols, rawMat.rows));
    const processMat = scope.track(new cv.Mat());
    if (scale < 1) {
      cv.resize(
        rawMat,
        processMat,
        new cv.Size(Math.round(rawMat.cols * scale), Math.round(rawMat.rows * scale)),
      );
    } else {
      rawMat.copyTo(processMat);
    }

    const gray = scope.track(new cv.Mat());
    cv.cvtColor(processMat, gray, cv.COLOR_RGBA2GRAY);
    return { rawMat, processMat, gray, scale };
  }

  async detectCanvasBounds(buffer: Buffer): Promise<CanvasBounds> {
    const cv = await this.getOpenCv();
    const image = await loadImage(buffer);
    assertImageDimensions(image.width, image.height);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, image.width, image.height);
    const scope = new CvResourceScope();

    try {
      const { processMat, gray } = this.processImage(cv, imageData, scope, DETECTION_MAX_SIZE);
      const blurred = scope.track(new cv.Mat());
      cv.blur(gray, blurred, new cv.Size(5, 5));

      const edges = scope.track(new cv.Mat());
      cv.Canny(blurred, edges, 30, 100, 3);

      const contours = scope.track(new cv.MatVector());
      const hierarchy = scope.track(new cv.Mat());
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let largestArea = 0;
      let bounds: CanvasBounds | null = null;
      for (let index = 0; index < contours.size(); index += 1) {
        const contour = scope.track(contours.get(index));
        const area = cv.contourArea(contour);
        const rectangle = cv.boundingRect(contour);
        if (
          area > largestArea &&
          rectangle.width > processMat.cols * 0.15 &&
          rectangle.height > processMat.rows * 0.15
        ) {
          largestArea = area;
          bounds = {
            ymin: rectangle.y / processMat.rows,
            xmin: rectangle.x / processMat.cols,
            ymax: (rectangle.y + rectangle.height) / processMat.rows,
            xmax: (rectangle.x + rectangle.width) / processMat.cols,
          };
        }
      }

      if (!bounds) {
        throw new ImageProcessingError('OpenCV could not detect a canvas boundary in this image.');
      }
      return bounds;
    } finally {
      scope.dispose();
    }
  }

  async warpPerspective(buffer: Buffer, points: PerspectivePoint[]): Promise<Buffer> {
    validatePerspectivePoints(points);
    const cv = await this.getOpenCv();
    const image = await loadImage(buffer);
    assertImageDimensions(image.width, image.height);
    const width = image.width;
    const height = image.height;

    const sourceCoordinates = points.flatMap((point) => [point.x * width, point.y * height]);
    const [x0, y0, x1, y1, x2, y2, x3, y3] = sourceCoordinates;
    const outputWidth = Math.round(
      Math.max(Math.hypot(x1 - x0, y1 - y0), Math.hypot(x2 - x3, y2 - y3)),
    );
    const outputHeight = Math.round(
      Math.max(Math.hypot(x3 - x0, y3 - y0), Math.hypot(x2 - x1, y2 - y1)),
    );
    if (outputWidth <= 0 || outputHeight <= 0) {
      throw new ImageProcessingError('Perspective coordinates describe a degenerate quadrilateral.');
    }

    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, width, height);
    const scope = new CvResourceScope();

    try {
      const source = scope.track(new cv.Mat(height, width, cv.CV_8UC4));
      source.data.set(imageData.data);
      const sourcePoints = scope.track(cv.matFromArray(4, 1, cv.CV_32FC2, sourceCoordinates));
      const destinationPoints = scope.track(
        cv.matFromArray(4, 1, cv.CV_32FC2, [
          0,
          0,
          outputWidth,
          0,
          outputWidth,
          outputHeight,
          0,
          outputHeight,
        ]),
      );
      const transform = scope.track(cv.getPerspectiveTransform(sourcePoints, destinationPoints));
      const warped = scope.track(new cv.Mat());
      cv.warpPerspective(source, warped, transform, new cv.Size(outputWidth, outputHeight));

      const outputCanvas = createCanvas(warped.cols, warped.rows);
      const outputContext = outputCanvas.getContext('2d');
      const outputImageData = outputContext.createImageData(warped.cols, warped.rows);
      outputImageData.data.set(new Uint8ClampedArray(warped.data));
      outputContext.putImageData(outputImageData, 0, 0);
      return outputCanvas.toBuffer('image/png');
    } finally {
      scope.dispose();
    }
  }

  async align(targetBuffer: Buffer, baseBuffer: Buffer): Promise<Buffer> {
    const cv = await this.getOpenCv();
    const baseImage = await loadImage(baseBuffer);
    const targetImage = await loadImage(targetBuffer);
    assertImageDimensions(baseImage.width, baseImage.height);
    assertImageDimensions(targetImage.width, targetImage.height);

    const baseCanvas = createCanvas(baseImage.width, baseImage.height);
    const baseContext = baseCanvas.getContext('2d');
    baseContext.drawImage(baseImage, 0, 0);
    const baseData = baseContext.getImageData(0, 0, baseImage.width, baseImage.height);

    const targetCanvas = createCanvas(targetImage.width, targetImage.height);
    const targetContext = targetCanvas.getContext('2d');
    targetContext.drawImage(targetImage, 0, 0);
    const targetData = targetContext.getImageData(0, 0, targetImage.width, targetImage.height);
    const scope = new CvResourceScope();

    try {
      const base = this.processImage(cv, baseData, scope, ALIGNMENT_MAX_SIZE);
      const target = this.processImage(cv, targetData, scope, ALIGNMENT_MAX_SIZE);
      const orb = scope.track(new cv.ORB(ALIGNMENT_MAX_FEATURES));

      const baseKeypoints = scope.track(new cv.KeyPointVector());
      const baseDescriptors = scope.track(new cv.Mat());
      orb.detectAndCompute(base.gray, scope.track(new cv.Mat()), baseKeypoints, baseDescriptors);

      const targetKeypoints = scope.track(new cv.KeyPointVector());
      const targetDescriptors = scope.track(new cv.Mat());
      orb.detectAndCompute(target.gray, scope.track(new cv.Mat()), targetKeypoints, targetDescriptors);

      if (baseDescriptors.empty() || targetDescriptors.empty()) {
        throw new ImageProcessingError(
          'Alignment failed: no distinctive visual keypoints were found in the images.',
        );
      }

      const matcher = scope.track(new cv.BFMatcher(cv.NORM_HAMMING, true));
      const matches = scope.track(new cv.DMatchVector());
      matcher.match(baseDescriptors, targetDescriptors, matches);

      let minimumDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < matches.size(); index += 1) {
        minimumDistance = Math.min(minimumDistance, matches.get(index).distance);
      }

      const goodMatches: FeatureMatch[] = [];
      for (let index = 0; index < matches.size(); index += 1) {
        const match = matches.get(index);
        if (match.distance <= Math.max(2 * minimumDistance, 30)) {
          goodMatches.push(match);
        }
      }
      if (goodMatches.length < ALIGNMENT_MIN_MATCHES) {
        throw new ImageProcessingError(
          'Alignment failed: insufficient matching visual features were found between milestones.',
        );
      }

      const sourceCoordinates: number[] = [];
      const destinationCoordinates: number[] = [];
      for (const match of goodMatches) {
        const basePoint = baseKeypoints.get(match.queryIdx).pt;
        const targetPoint = targetKeypoints.get(match.trainIdx).pt;
        destinationCoordinates.push(basePoint.x / base.scale, basePoint.y / base.scale);
        sourceCoordinates.push(targetPoint.x / target.scale, targetPoint.y / target.scale);
      }

      const sourcePoints = scope.track(
        cv.matFromArray(goodMatches.length, 1, cv.CV_32FC2, sourceCoordinates),
      );
      const destinationPoints = scope.track(
        cv.matFromArray(goodMatches.length, 1, cv.CV_32FC2, destinationCoordinates),
      );
      const homography = scope.track(
        cv.findHomography(sourcePoints, destinationPoints, cv.RANSAC, ALIGNMENT_RANSAC_THRESHOLD),
      );
      if (homography.empty()) {
        throw new ImageProcessingError(
          'Alignment failed: a perspective alignment matrix could not be determined.',
        );
      }

      if (!this.isSaneHomography(homography)) {
        throw new ImageProcessingError(
          'Alignment failed: the calculated perspective transform is too distorted.',
        );
      }

      const aligned = scope.track(new cv.Mat());
      cv.warpPerspective(
        target.rawMat,
        aligned,
        homography,
        new cv.Size(base.rawMat.cols, base.rawMat.rows),
      );

      const outputCanvas = createCanvas(aligned.cols, aligned.rows);
      const outputContext = outputCanvas.getContext('2d');
      const outputImageData = outputContext.createImageData(aligned.cols, aligned.rows);
      outputImageData.data.set(new Uint8ClampedArray(aligned.data));
      outputContext.putImageData(outputImageData, 0, 0);
      return outputCanvas.toBuffer('image/png');
    } finally {
      scope.dispose();
    }
  }

  private isSaneHomography(homography: {
    rows: number;
    cols: number;
    doubleAt(row: number, column: number): number;
  }): boolean {
    if (homography.rows !== 3 || homography.cols !== 3) return false;

    let h0 = homography.doubleAt(0, 0);
    let h1 = homography.doubleAt(0, 1);
    let h3 = homography.doubleAt(1, 0);
    let h4 = homography.doubleAt(1, 1);
    let h6 = homography.doubleAt(2, 0);
    let h7 = homography.doubleAt(2, 1);
    const h8 = homography.doubleAt(2, 2);
    if (Math.abs(h8) <= Number.EPSILON) return false;

    h0 /= h8;
    h1 /= h8;
    h3 /= h8;
    h4 /= h8;
    h6 /= h8;
    h7 /= h8;

    const scaleX = Math.hypot(h0, h3);
    const scaleY = Math.hypot(h1, h4);
    if (scaleX === 0 || scaleY === 0) return false;
    const skew = Math.abs(h0 * h1 + h3 * h4) / (scaleX * scaleY);

    return (
      scaleX >= 0.4 &&
      scaleX <= 2.2 &&
      scaleY >= 0.4 &&
      scaleY <= 2.2 &&
      skew <= 0.5 &&
      Math.abs(h6) <= 0.008 &&
      Math.abs(h7) <= 0.008
    );
  }
}
