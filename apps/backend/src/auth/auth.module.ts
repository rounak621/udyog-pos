import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { AppAuthController } from './app-auth.controller';
import { AppSessionsService } from './app-sessions.service';
import { AuthController } from './auth.controller';
import { BranchAccessService } from '../common/services/branch-access.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [
    PassportModule,
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        ({
          secret: config.getOrThrow<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '12h',
          },
        }) as JwtModuleOptions,
    }),
  ],
  controllers: [AuthController, AppAuthController],
  providers: [
    AuthService,
    JwtStrategy,
    TwoFactorService,
    AppSessionsService,
    BranchAccessService,
  ],
  exports: [AuthService, AppSessionsService],
})
export class AuthModule {}
