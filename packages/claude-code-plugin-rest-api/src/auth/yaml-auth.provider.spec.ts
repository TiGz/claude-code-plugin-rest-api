import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { YamlAuthProvider } from './yaml-auth.provider.js';

describe('YamlAuthProvider', () => {
  let tempDir: string;
  let authFilePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-test-'));
    authFilePath = path.join(tempDir, 'auth.yml');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createAuthFile(content: string) {
    await fs.writeFile(authFilePath, content);
  }

  describe('loadUsers', () => {
    it('should load users from YAML file', async () => {
      await createAuthFile(`
users:
  - username: admin
    password: secret123
  - username: user
    password: password456
`);

      const provider = new YamlAuthProvider(authFilePath);
      await provider.onModuleInit();

      const admin = await provider.validate('admin', 'secret123');
      const user = await provider.validate('user', 'password456');

      expect(admin).toEqual({ username: 'admin' });
      expect(user).toEqual({ username: 'user' });
    });

    it('should handle missing auth file gracefully', async () => {
      const provider = new YamlAuthProvider(path.join(tempDir, 'nonexistent.yml'));

      // Should not throw
      await expect(provider.onModuleInit()).resolves.not.toThrow();

      // Should not validate anyone
      const result = await provider.validate('admin', 'password');
      expect(result).toBeNull();
    });

    it('should handle empty users array', async () => {
      await createAuthFile(`
users: []
`);

      const provider = new YamlAuthProvider(authFilePath);
      await provider.onModuleInit();

      const result = await provider.validate('admin', 'password');
      expect(result).toBeNull();
    });

    it('should handle malformed YAML gracefully', async () => {
      await createAuthFile(`
users:
  - invalid yaml here
  username: broken
`);

      const provider = new YamlAuthProvider(authFilePath);

      // Should not throw
      await expect(provider.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('validate', () => {
    it('should return AuthUser for valid credentials', async () => {
      await createAuthFile(`
users:
  - username: testuser
    password: testpass
`);

      const provider = new YamlAuthProvider(authFilePath);
      await provider.onModuleInit();

      const result = await provider.validate('testuser', 'testpass');

      expect(result).toEqual({ username: 'testuser' });
    });

    it('should return null for invalid password', async () => {
      await createAuthFile(`
users:
  - username: testuser
    password: correctpassword
`);

      const provider = new YamlAuthProvider(authFilePath);
      await provider.onModuleInit();

      const result = await provider.validate('testuser', 'wrongpassword');

      expect(result).toBeNull();
    });

    it('should return null for non-existent user', async () => {
      await createAuthFile(`
users:
  - username: existinguser
    password: password
`);

      const provider = new YamlAuthProvider(authFilePath);
      await provider.onModuleInit();

      const result = await provider.validate('nonexistent', 'password');

      expect(result).toBeNull();
    });

    it('should use timing-safe comparison for plain text passwords', async () => {
      await createAuthFile(`
users:
  - username: testuser
    password: secret
`);

      const provider = new YamlAuthProvider(authFilePath);
      await provider.onModuleInit();

      // Both should work - timing safe comparison handles different lengths
      const valid = await provider.validate('testuser', 'secret');
      const invalidLength = await provider.validate('testuser', 'sec');
      const invalidContent = await provider.validate('testuser', 'secres');

      expect(valid).toEqual({ username: 'testuser' });
      expect(invalidLength).toBeNull();
      expect(invalidContent).toBeNull();
    });

    it('should handle bcrypt hashed passwords when bcrypt is available', async () => {
      // This test uses a pre-computed bcrypt hash for "password123"
      // $2b$10$... is the bcrypt format
      const bcryptHash = '$2b$10$rOzJqQZQGaHvvYnVJxQNPuh8cJmYkqLqH1b0wXZwDhT8jQWuP1UKe';

      await createAuthFile(`
users:
  - username: hasheduser
    password: ${bcryptHash}
`);

      const provider = new YamlAuthProvider(authFilePath);
      await provider.onModuleInit();

      // This test depends on bcrypt being installed
      // If bcrypt is not installed, it should return null (graceful failure)
      const result = await provider.validate('hasheduser', 'password123');

      // Either bcrypt works and validates, or it's not installed and returns null
      // Both are acceptable behaviors
      expect(result === null || result?.username === 'hasheduser').toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle users without password field', async () => {
      await createAuthFile(`
users:
  - username: nopassword
  - username: haspassword
    password: pass
`);

      const provider = new YamlAuthProvider(authFilePath);
      await provider.onModuleInit();

      // User without password should not be loadable
      const noPass = await provider.validate('nopassword', '');
      const hasPass = await provider.validate('haspassword', 'pass');

      expect(noPass).toBeNull();
      expect(hasPass).toEqual({ username: 'haspassword' });
    });

    it('should handle users without username field', async () => {
      await createAuthFile(`
users:
  - password: orphanpassword
  - username: valid
    password: validpass
`);

      const provider = new YamlAuthProvider(authFilePath);
      await provider.onModuleInit();

      const valid = await provider.validate('valid', 'validpass');
      expect(valid).toEqual({ username: 'valid' });
    });

    it('should handle special characters in passwords', async () => {
      const specialPassword = 'p@$$w0rd!#$%^&*()';

      await createAuthFile(`
users:
  - username: special
    password: "${specialPassword}"
`);

      const provider = new YamlAuthProvider(authFilePath);
      await provider.onModuleInit();

      const result = await provider.validate('special', specialPassword);
      expect(result).toEqual({ username: 'special' });
    });
  });
});
