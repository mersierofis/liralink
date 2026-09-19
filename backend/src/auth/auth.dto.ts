import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import type {
  PostAuthLoginRequest,
  PostAuthLoginResponse,
  PostAuthRegisterRequest,
} from '../contract/api.types';
import { MerchantDto } from '../merchants/merchant.dto';

/** bcrypt only reads the first 72 bytes of a password; longer ones are rejected, not truncated. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72;

export class RegisterDto implements PostAuthRegisterRequest {
  @IsEmail()
  email!: string;

  /** 8+ characters, at most 72 bytes. */
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX_BYTES)
  password!: string;

  @IsString()
  @IsNotEmpty()
  businessName!: string;
}

export class LoginDto implements PostAuthLoginRequest {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class AuthResponseDto implements PostAuthLoginResponse {
  token!: string;
  merchant!: MerchantDto;
}
