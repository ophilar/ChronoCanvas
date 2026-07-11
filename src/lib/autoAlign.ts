import { safeJsonParse } from './utils';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

let cvPromise: Promise<any> | null = null;

// Dynamic loader for OpenCV.js on the client side
export function loadClientCV(): Promise<any> {
  if (cvPromise) return cvPromise;

  cvPromise = new Promise((resolve, reject) => {
    if ((window as any).cv && (window as any).cv.Mat) {
      resolve((window as any).cv);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://docs.opencv.org/4.10.0/opencv.js";
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      const checkCV = () => {
        if ((window as any).cv && (window as any).cv.Mat) {
          resolve((window as any).cv);
        } else if ((window as any).cv) {
          (window as any).cv.onRuntimeInitialized = () => {
            resolve((window as any).cv);
          };
        } else {
          setTimeout(checkCV, 50);
        }
      };
      checkCV();
    };

    script.onerror = (err) => {
      cvPromise = null;
      reject(new Error("Failed to load OpenCV.js from CDN: " + err));
    };

    document.head.appendChild(script);
  });

  return cvPromise;
}

// Client-Side Homography & Warp Perspective Auto-Alignment
export async function autoAlignImage(params: { baseImgUrl?: string; baseFile?: File | Blob; targetFile: File | Blob }): Promise<Blob> {
    const cvObj = await loadClientCV().catch(() => null);
    if (!cvObj) {
        // Fallback to server integration in case CDN is completely blocked or fails
        console.warn("Client-side OpenCV.js failed to load, falling back to server-side alignment...");
        const formData = new FormData();
        if (params.baseImgUrl) {
          formData.append("baseImgUrl", params.baseImgUrl);
        }
        if (params.baseFile) {
          formData.append("base", params.baseFile);
        }
        formData.append("target", params.targetFile);

        const res = await fetch("/api/align", {
            method: "POST",
            body: formData
        });

        if (!res.ok) {
            const err = await safeJsonParse(res).catch(() => ({}));
            throw new Error(err.error || "Alignment failed on server");
        }

        return await res.blob();
    }

    let baseSrc = "";
    let isBaseObjectURL = false;
    if (params.baseFile) {
        baseSrc = URL.createObjectURL(params.baseFile);
        isBaseObjectURL = true;
    } else if (params.baseImgUrl) {
        baseSrc = params.baseImgUrl;
        if (baseSrc.startsWith("/")) {
            // Force relative paths to absolute so HTML Canvas crossOrigin checks don't block
            baseSrc = window.location.origin + baseSrc;
        }
    } else {
        throw new Error("Missing active base layer to align against.");
    }

    let targetSrc = URL.createObjectURL(params.targetFile);

    const disposables: any[] = [];
    const track = <T>(obj: T): T => {
        if (obj && typeof (obj as any).delete === 'function') {
            disposables.push(obj);
        }
        return obj;
    };

    try {
        const [baseImg, targetImg] = await Promise.all([
            loadImage(baseSrc),
            loadImage(targetSrc)
        ]);

        const baseCanvas = document.createElement('canvas');
        baseCanvas.width = baseImg.width;
        baseCanvas.height = baseImg.height;
        const baseCtx = baseCanvas.getContext('2d');
        if (!baseCtx) throw new Error("Could not construct canvas context for base image");
        baseCtx.drawImage(baseImg, 0, 0);
        const baseData = baseCtx.getImageData(0, 0, baseImg.width, baseImg.height);

        const targetCanvas = document.createElement('canvas');
        targetCanvas.width = targetImg.width;
        targetCanvas.height = targetImg.height;
        const targetCtx = targetCanvas.getContext('2d');
        if (!targetCtx) throw new Error("Could not construct canvas context for target image");
        targetCtx.drawImage(targetImg, 0, 0);
        const targetData = targetCtx.getImageData(0, 0, targetImg.width, targetImg.height);

        // Resize function matching the server's processImageForCV
        const processImageForCVMlocal = (imgData: ImageData, maxSize = 800) => {
            let rawMat = track(new cvObj.Mat(imgData.height, imgData.width, cvObj.CV_8UC4));
            rawMat.data.set(imgData.data);
            
            let scale = 1;
            if (rawMat.cols > maxSize || rawMat.rows > maxSize) {
                scale = maxSize / Math.max(rawMat.cols, rawMat.rows);
            }
            
            let processMat = track(new cvObj.Mat());
            if (scale !== 1) {
                cvObj.resize(rawMat, processMat, new cvObj.Size(Math.round(rawMat.cols * scale), Math.round(rawMat.rows * scale)));
            } else {
                rawMat.copyTo(processMat);
            }
            
            let gray = track(new cvObj.Mat());
            cvObj.cvtColor(processMat, gray, cvObj.COLOR_RGBA2GRAY);
            
            return { rawMat, processMat, gray, scale };
        };

        const base = processImageForCVMlocal(baseData, 800);
        const target = processImageForCVMlocal(targetData, 800);

        const MAX_FEATURES = 5000;
        let orb = track(new cvObj.ORB(MAX_FEATURES));

        let kp1 = track(new cvObj.KeyPointVector());
        let des1 = track(new cvObj.Mat());
        orb.detectAndCompute(base.gray, track(new cvObj.Mat()), kp1, des1);

        let kp2 = track(new cvObj.KeyPointVector());
        let des2 = track(new cvObj.Mat());
        orb.detectAndCompute(target.gray, track(new cvObj.Mat()), kp2, des2);

        if (des1.empty() || des2.empty() || des1.rows === 0 || des2.rows === 0) {
            throw new Error("Alignment failed: No distinctive visual keypoints could be identified to align these milestones. Please upload a clear photo with distinctive brushstrokes.");
        }

        let matcher = track(new cvObj.BFMatcher(cvObj.NORM_HAMMING, true));
        let matches = track(new cvObj.DMatchVector());
        matcher.match(des1, des2, matches);

        let minDist = 10000;
        for (let i = 0; i < matches.size(); i++) {
            let m = matches.get(i);
            if (m.distance < minDist) minDist = m.distance;
        }
        
        let good_matches = [];
        for (let i = 0; i < matches.size(); i++) {
            let m = matches.get(i);
            if (m.distance <= Math.max(2 * minDist, 30.0)) {
                good_matches.push(m);
            }
        }

        if (good_matches.length < 10) {
            throw new Error("Alignment failed: The app needs clear distinctive features in your brushwork milestones to align properly. Please upload a clear painting photo without hands or canvas borders visible.");
        }

        let srcPtsData = [];
        let dstPtsData = [];
        for (let i = 0; i < good_matches.length; i++) {
            let m = good_matches[i];
            let p1 = kp1.get(m.queryIdx).pt; 
            let p2 = kp2.get(m.trainIdx).pt; 
            
            dstPtsData.push(p1.x / base.scale);
            dstPtsData.push(p1.y / base.scale);
            
            srcPtsData.push(p2.x / target.scale);
            srcPtsData.push(p2.y / target.scale);
        }
        
        let srcPts = track(cvObj.matFromArray(good_matches.length, 1, cvObj.CV_32FC2, srcPtsData));
        let dstPts = track(cvObj.matFromArray(good_matches.length, 1, cvObj.CV_32FC2, dstPtsData));

        let M = track(cvObj.findHomography(srcPts, dstPts, cvObj.RANSAC, 5.0));
        if (M.empty()) {
            throw new Error("Could not determine perspective alignment matrix.");
        }

        // Homography sanity check to prevent extreme warping, stretching, flipping or shearing
        let isValid = true;
        if (M.rows === 3 && M.cols === 3) {
            let h0 = M.doubleAt(0, 0);
            let h1 = M.doubleAt(0, 1);
            let h3 = M.doubleAt(1, 0);
            let h4 = M.doubleAt(1, 1);
            let h6 = M.doubleAt(2, 0);
            let h7 = M.doubleAt(2, 1);
            let h8 = M.doubleAt(2, 2);

            if (Math.abs(h8) > 0.0001) {
                h0 /= h8; h1 /= h8; h3 /= h8; h4 /= h8; h6 /= h8; h7 /= h8;
            }

            const scaleX = Math.sqrt(h0 * h0 + h3 * h3);
            const scaleY = Math.sqrt(h1 * h1 + h4 * h4);
            const skew = Math.abs(h0 * h1 + h3 * h4) / (scaleX * scaleY || 1);

            if (scaleX < 0.4 || scaleX > 2.2 || scaleY < 0.4 || scaleY > 2.2 || skew > 0.5 || Math.abs(h6) > 0.008 || Math.abs(h7) > 0.008) {
                isValid = false;
            }
        } else {
            isValid = false;
        }

        if (!isValid) {
            throw new Error("Alignment failed: Calculated warp is too distorted. Keep your camera flat and steady against the frame.");
        }

        let aligned = track(new cvObj.Mat());
        cvObj.warpPerspective(target.rawMat, aligned, M, new cvObj.Size(base.rawMat.cols, base.rawMat.rows));

        const outCanvas = document.createElement('canvas');
        outCanvas.width = aligned.cols;
        outCanvas.height = aligned.rows;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) throw new Error("Could not construct 2D context for drawing aligned image dataset");
        const outImgData = outCtx.createImageData(aligned.cols, aligned.rows);
        outImgData.data.set(new Uint8ClampedArray(aligned.data));
        outCtx.putImageData(outImgData, 0, 0);

        return new Promise<Blob>((resolve) => {
            outCanvas.toBlob((blob) => {
                resolve(blob!);
            }, 'image/png');
        });

    } finally {
        URL.revokeObjectURL(targetSrc);
        if (isBaseObjectURL) {
            URL.revokeObjectURL(baseSrc);
        }
        for (const d of disposables) {
            try {
                d.delete();
            } catch (e) {
                console.error("Failed to delete cv object:", e);
            }
        }
    }
}

// Solve 8x8 matrix system using Gaussian Elimination with partial pivoting
function solveGaussian(A: number[][], B: number[]): number[] {
  const n = B.length;
  // Augment matrix A with vector B
  for (let i = 0; i < n; i++) {
    A[i].push(B[i]);
  }

  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxEl = Math.abs(A[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > maxEl) {
        maxEl = Math.abs(A[k][i]);
        maxRow = k;
      }
    }

    // Swap maximum row with current row
    const temp = A[maxRow];
    A[maxRow] = A[i];
    A[i] = temp;

    // Make all rows below this one 0 in current column
    if (Math.abs(A[i][i]) < 1e-10) {
      throw new Error("Mathematical singularity encountered in Homography calculation. Ensure points are not collinear.");
    }

    for (let k = i + 1; k < n; k++) {
      const c = -A[k][i] / A[i][i];
      for (let j = i; j < n + 1; j++) {
        if (i === j) {
          A[k][j] = 0;
        } else {
          A[k][j] += c * A[i][j];
        }
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = A[i][n] / A[i][i];
    for (let k = i - 1; k >= 0; k--) {
      A[k][n] -= A[k][i] * x[i];
    }
  }
  return x;
}

export async function warpPerspectiveImage(fileOrBlobOrUrl: File | Blob | string, points: { x: number; y: number }[]): Promise<Blob> {
    if (points.length !== 4) {
        throw new Error("Perspective warping requires exactly 4 points.");
    }

    let srcUrl = "";
    let isObjectURL = false;
    if (fileOrBlobOrUrl instanceof File || fileOrBlobOrUrl instanceof Blob) {
        srcUrl = URL.createObjectURL(fileOrBlobOrUrl);
        isObjectURL = true;
    } else {
        srcUrl = fileOrBlobOrUrl;
        if (srcUrl.startsWith("/")) {
            // Force relative paths to absolute so HTML Canvas crossOrigin checks don't block
            srcUrl = window.location.origin + srcUrl;
        }
    }

    try {
        const img = await loadImage(srcUrl);
        const width = img.width;
        const height = img.height;

        // Denormalize the 4 perspective points (TL, TR, BR, BL)
        const x0 = points[0].x * width;
        const y0 = points[0].y * height;
        const x1 = points[1].x * width;
        const y1 = points[1].y * height;
        const x2 = points[2].x * width;
        const y2 = points[2].y * height;
        const x3 = points[3].x * width;
        const y3 = points[3].y * height;

        // Calculate size of target bounding rectangle using Euclidean distance
        const widthA = Math.hypot(x1 - x0, y1 - y0);
        const widthB = Math.hypot(x2 - x3, y2 - y3);
        const targetWidth = Math.max(1, Math.round(Math.max(widthA, widthB)));

        const heightA = Math.hypot(x3 - x0, y3 - y0);
        const heightB = Math.hypot(x2 - x1, y2 - y1);
        const targetHeight = Math.max(1, Math.round(Math.max(heightA, heightB)));

        // Source canvas to extract pixels
        const srcCanvas = document.createElement("canvas");
        srcCanvas.width = width;
        srcCanvas.height = height;
        const srcCtx = srcCanvas.getContext("2d");
        if (!srcCtx) throw new Error("Could not construct 2D context for drawing source image.");
        srcCtx.drawImage(img, 0, 0);
        const srcData = srcCtx.getImageData(0, 0, width, height);

        // Destination canvas to draw warped pixels
        const dstCanvas = document.createElement("canvas");
        dstCanvas.width = targetWidth;
        dstCanvas.height = targetHeight;
        const dstCtx = dstCanvas.getContext("2d");
        if (!dstCtx) throw new Error("Could not construct 2D context for drawing warped target image.");
        const dstData = dstCtx.createImageData(targetWidth, targetHeight);

        // We solve for the backwards mapping from destination coordinates (u, v) to source coordinates (x, y).
        const dstPts = [
            { u: 0, v: 0 },
            { u: targetWidth, v: 0 },
            { u: targetWidth, v: targetHeight },
            { u: 0, v: targetHeight }
        ];
        const srcPts = [
            { x: x0, y: y0 },
            { x: x1, y: y1 },
            { x: x2, y: y2 },
            { x: x3, y: y3 }
        ];

        // Setup the linear equations system mapping: (ui, vi) -> (xi, yi)
        const A: number[][] = [];
        const B: number[] = [];

        for (let i = 0; i < 4; i++) {
            const ui = dstPts[i].u;
            const vi = dstPts[i].v;
            const xi = srcPts[i].x;
            const yi = srcPts[i].y;

            A.push([ui, vi, 1, 0, 0, 0, -ui * xi, -vi * xi]);
            B.push(xi);

            A.push([0, 0, 0, ui, vi, 1, -ui * yi, -vi * yi]);
            B.push(yi);
        }

        const H = solveGaussian(A, B);
        const [h0, h1, h2, h3, h4, h5, h6, h7] = H;

        // Perform backward mapping and bilinear interpolation
        const srcPixels = srcData.data;
        const dstPixels = dstData.data;

        for (let v = 0; v < targetHeight; v++) {
            for (let u = 0; u < targetWidth; u++) {
                const denom = h6 * u + h7 * v + 1.0;
                let x = (h0 * u + h1 * v + h2) / denom;
                let y = (h3 * u + h4 * v + h5) / denom;

                // Restrict mappings within the physical image boundary
                x = Math.max(0, Math.min(width - 1, x));
                y = Math.max(0, Math.min(height - 1, y));

                const xf = Math.floor(x);
                const yf = Math.floor(y);
                const xc = Math.min(xf + 1, width - 1);
                const yc = Math.min(yf + 1, height - 1);

                const dx = x - xf;
                const dy = y - yf;

                const w00 = (1.0 - dx) * (1.0 - dy);
                const w10 = dx * (1.0 - dy);
                const w01 = (1.0 - dx) * dy;
                const w11 = dx * dy;

                const idx00 = (yf * width + xf) * 4;
                const idx10 = (yf * width + xc) * 4;
                const idx01 = (yc * width + xf) * 4;
                const idx11 = (yc * width + xc) * 4;

                const dstIdx = (v * targetWidth + u) * 4;

                // Bilinear interpolation for Red, Green, Blue, Alpha
                dstPixels[dstIdx] = Math.round(w00 * srcPixels[idx00] + w10 * srcPixels[idx10] + w01 * srcPixels[idx01] + w11 * srcPixels[idx11]);
                dstPixels[dstIdx + 1] = Math.round(w00 * srcPixels[idx00 + 1] + w10 * srcPixels[idx10 + 1] + w01 * srcPixels[idx01 + 1] + w11 * srcPixels[idx11 + 1]);
                dstPixels[dstIdx + 2] = Math.round(w00 * srcPixels[idx00 + 2] + w10 * srcPixels[idx10 + 2] + w01 * srcPixels[idx01 + 2] + w11 * srcPixels[idx11 + 2]);
                dstPixels[dstIdx + 3] = Math.round(w00 * srcPixels[idx00 + 3] + w10 * srcPixels[idx10 + 3] + w01 * srcPixels[idx01 + 3] + w11 * srcPixels[idx11 + 3]);
            }
        }

        dstCtx.putImageData(dstData, 0, 0);

        return new Promise<Blob>((resolve) => {
            dstCanvas.toBlob((blob) => {
                resolve(blob!);
            }, 'image/jpeg', 0.95);
        });

    } finally {
        if (isObjectURL) {
            URL.revokeObjectURL(srcUrl);
        }
    }
}
