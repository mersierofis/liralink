import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PostAuthLoginResponse, PostAuthRegisterResponse } from '../contract/api.types';
import { AuthResponseDto, LoginDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /auth/register → 201 */
  @Post('register')
  @ApiCreatedResponse({ type: AuthResponseDto })
  register(@Body() body: RegisterDto): Promise<PostAuthRegisterResponse> {
    return this.auth.register(body);
  }

  /** POST /auth/login → 200 */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthResponseDto })
  login(@Body() body: LoginDto): Promise<PostAuthLoginResponse> {
    return this.auth.login(body);
  }
}
