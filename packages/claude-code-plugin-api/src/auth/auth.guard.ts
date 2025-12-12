import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthProvider, AuthModuleOptions, AUTH_OPTIONS, AUTH_PROVIDER } from './auth.types.js';

@Injectable()
export class BasicAuthGuard implements CanActivate {
  private readonly logger = new Logger(BasicAuthGuard.name);

  constructor(
    @Inject(AUTH_OPTIONS) private readonly options: AuthModuleOptions,
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Auth disabled - allow all requests
    if (this.options.disabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const requestPath = request.path;

    // Check excluded paths
    if (this.isExcludedPath(requestPath)) {
      return true;
    }

    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const base64Credentials = authHeader.slice(6);
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');

    if (!username || !password) {
      throw new UnauthorizedException('Invalid credentials format');
    }

    const user = await this.provider.validate(username, password);

    if (!user) {
      this.logger.warn(`Failed auth attempt for user: ${username}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Attach user to request for downstream use
    (request as Request & { user: unknown }).user = user;
    return true;
  }

  private isExcludedPath(requestPath: string): boolean {
    const excludePaths = this.options.excludePaths || ['/health', '/api/docs*'];

    return excludePaths.some((pattern) => {
      if (pattern.endsWith('*')) {
        return requestPath.startsWith(pattern.slice(0, -1));
      }
      return requestPath === pattern;
    });
  }
}
