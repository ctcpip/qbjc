/** Interface for platform-specific functionality. */
export default interface Platform {
  writeStdout(s: string): void;
}