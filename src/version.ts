declare const __SDK_VERSION__: string | undefined;

export const VERSION: string =
  typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : '0.0.0-dev';
