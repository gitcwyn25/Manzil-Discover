import { runningVersion } from '../../app-config';

/** How every request to a liketrek service names its sender. */
export function serviceUserAgent(): string {
  return `Manzil/${runningVersion()} (+https://github.com/liketrek/TREK)`;
}
