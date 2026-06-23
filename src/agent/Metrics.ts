export class Metrics {
  private static startTime: number = Date.now();

  /**
   * Returns the global uptime of the Aurix instance in milliseconds
   */
  public static getUptimeMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Returns the global uptime in HH:MM:SS format
   */
  public static getUptimeFormatted(): string {
    const totalSeconds = Math.floor(this.getUptimeMs() / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0')
    ].join(':');
  }
}
