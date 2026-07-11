import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function safeJsonParse(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Invalid JSON response (Status: ${response.status}). Response preview: ${text.slice(0, 150) || "(empty response)"}`);
  }
}
