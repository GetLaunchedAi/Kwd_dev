import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

class Logger {
  private logDir: string;

  constructor() {
    this.logDir = path.join(process.cwd(), 'logs');
    fs.ensureDirSync(this.logDir);
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    return `[${timestamp}] [${level}] ${message} ${formattedArgs}`;
  }

  private writeToFile(level: LogLevel, message: string, ...args: any[]): void {
    const logFile = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
    const logMessage = this.formatMessage(level, message, ...args);
    fs.appendFileSync(logFile, logMessage + '\n');
  }

  debug(message: string, ...args: any[]): void {
    const formatted = this.formatMessage(LogLevel.DEBUG, message, ...args);
    console.log(chalk.gray(formatted));
    this.writeToFile(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: any[]): void {
    const formatted = this.formatMessage(LogLevel.INFO, message, ...args);
    console.log(chalk.blue(formatted));
    this.writeToFile(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    const formatted = this.formatMessage(LogLevel.WARN, message, ...args);
    console.log(chalk.yellow(formatted));
    this.writeToFile(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: any[]): void {
    const formatted = this.formatMessage(LogLevel.ERROR, message, ...args);
    console.error(chalk.red(formatted));
    this.writeToFile(LogLevel.ERROR, message, ...args);
  }
}

export const logger = new Logger();












