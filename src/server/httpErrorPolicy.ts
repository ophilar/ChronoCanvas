export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

export class UpstreamServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UpstreamServiceError';
  }
}

export interface HttpErrorResponse {
  status: number;
  message: string;
}

export function toHttpErrorResponse(error: unknown): HttpErrorResponse {
  if (error instanceof RequestValidationError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof ImageProcessingError) {
    return { status: 422, message: error.message };
  }
  if (error instanceof UpstreamServiceError) {
    return { status: 502, message: error.message };
  }
  return { status: 500, message: 'Internal server error.' };
}
