import { DOMParser } from 'linkedom';

export function loadSvg(text: string): Document {
  return new DOMParser().parseFromString(text, 'image/svg+xml') as unknown as Document;
}
