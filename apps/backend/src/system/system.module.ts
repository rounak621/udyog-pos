import { Module } from '@nestjs/common';
import { ShellCheckController } from './shell-check.controller';
import { UpdateController } from './update.controller';
import { UpdateService } from './update.service';

@Module({
  controllers: [UpdateController, ShellCheckController],
  providers: [UpdateService],
})
export class SystemModule {}
