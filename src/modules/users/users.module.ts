import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersController } from './users.controller';
import { UploadsController } from './uploads.controller';
import { UsersService } from './users.service';
import { OtpDeliveryService } from '../auth/otp-delivery.service';

@Module({
  imports: [ConfigModule],
  controllers: [UsersController, UploadsController],
  providers: [UsersService, OtpDeliveryService],
  exports: [UsersService],
})
export class UsersModule {}
