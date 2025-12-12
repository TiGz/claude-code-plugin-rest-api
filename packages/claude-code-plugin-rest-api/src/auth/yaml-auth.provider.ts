import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as crypto from 'crypto';
import { AuthProvider, AuthUser } from './auth.types.js';

interface AuthYamlConfig {
  users: Array<{
    username: string;
    password: string; // Plain text or bcrypt hash (prefix with $2b$)
  }>;
}

@Injectable()
export class YamlAuthProvider implements AuthProvider, OnModuleInit {
  private readonly logger = new Logger(YamlAuthProvider.name);
  private users = new Map<string, string>();
  private authFilePath: string;

  constructor(authFilePath: string = 'auth.yml') {
    this.authFilePath = path.resolve(process.cwd(), authFilePath);
  }

  async onModuleInit() {
    await this.loadUsers();
  }

  private async loadUsers(): Promise<void> {
    try {
      const content = await fs.readFile(this.authFilePath, 'utf-8');
      const config = yaml.load(content) as AuthYamlConfig;

      if (!config?.users || !Array.isArray(config.users)) {
        this.logger.warn(`No users found in ${this.authFilePath}`);
        return;
      }

      for (const user of config.users) {
        if (user.username && user.password) {
          this.users.set(user.username, user.password);
        }
      }

      this.logger.log(`Loaded ${this.users.size} users from ${this.authFilePath}`);
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        this.logger.warn(`Auth file not found: ${this.authFilePath}. API is UNPROTECTED!`);
        this.logger.warn(`Create ${this.authFilePath} or disable auth with { auth: { disabled: true } }`);
      } else {
        this.logger.error(`Failed to load auth file: ${err.message}`);
      }
    }
  }

  async validate(username: string, password: string): Promise<AuthUser | null> {
    const storedPassword = this.users.get(username);

    if (!storedPassword) {
      return null;
    }

    // Check if it's a bcrypt hash (starts with $2b$, $2a$, or $2y$)
    if (storedPassword.startsWith('$2')) {
      // For bcrypt, use bcrypt.compare() if available
      try {
        const bcrypt = await import('bcrypt');
        const isValid = await bcrypt.compare(password, storedPassword);
        return isValid ? { username } : null;
      } catch {
        this.logger.warn('bcrypt not installed, cannot verify hashed passwords. Install bcrypt: pnpm add bcrypt');
        return null;
      }
    }

    // Plain text comparison (for development only)
    // Use timing-safe comparison to prevent timing attacks
    try {
      const passwordBuffer = Buffer.from(password);
      const storedBuffer = Buffer.from(storedPassword);

      if (passwordBuffer.length !== storedBuffer.length) {
        return null;
      }

      const isValid = crypto.timingSafeEqual(passwordBuffer, storedBuffer);
      return isValid ? { username } : null;
    } catch {
      return null;
    }
  }
}
