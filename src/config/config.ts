import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  BASE_URL: z.string().default('http://localhost'),
  PORT: z.string().default('5000').transform((v) => parseInt(v, 10)),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NODE_ENV: z.string().default('development'),
  SALT_ROUNDS: z.string().default('10').transform((v) => parseInt(v, 10)),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRATION_TIME: z.string().default('2592000').transform((v) => parseInt(v, 10)),
  REFRESH_TOKEN_SECRET: z.string().optional(),
  REFRESH_TOKEN_EXPIRATION_TIME: z.string().default('2592000').transform((v) => parseInt(v, 10)),
  EMAIL_HOST: z.string().default(''),
  EMAIL_PORT: z.string().default('587').transform((v) => parseInt(v, 10)),
  EMAIL_USER: z.string().default(''),
  EMAIL_PASSWORD: z.string().default(''),
  EMAIL_FROM: z.string().default(''),
  MAX_JSON_SIZE: z.string().default('50mb'),
  MAX_FILE_SIZE: z.string().default('52428800').transform((v) => parseInt(v, 10)),
  URL_ENCODED: z.string().default('true').transform((v) => v === 'true'),
  REQUEST_LIMIT_TIME: z.string().default('900000').transform((v) => parseInt(v, 10)),
  REQUEST_LIMIT_NUMBER: z.string().default('3000').transform((v) => parseInt(v, 10)),
  WEB_CACHE: z.string().default('false').transform((v) => v === 'true'),
  STORAGE_PROVIDER: z.enum(['local', 'cloudinary']).default('local'),
  CLOUDINARY_CLOUD_NAME: z.string().default(''),
  CLOUDINARY_API_KEY: z.string().default(''),
  CLOUDINARY_API_SECRET: z.string().default(''),
}).superRefine((env, ctx) => {
  // Missing Cloudinary credentials used to surface as a confusing failure on
  // the first upload, long after deploy. Refuse to boot instead: a container
  // that cannot store a file is misconfigured, not merely degraded.
  if (env.STORAGE_PROVIDER !== 'cloudinary') return;
  for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const) {
    if (!env[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when STORAGE_PROVIDER=cloudinary`,
      });
    }
  }
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Environment validation failed:', parsedEnv.error.format());
  throw new Error('Invalid or missing environment variables');
}

const env = parsedEnv.data;

const jwtSecret = env.JWT_SECRET;
const refreshTokenSecret = env.REFRESH_TOKEN_SECRET || `${jwtSecret}_refresh`;

interface Config {
  BASE_URL: string;
  PORT: number;
  DATABASE_URL: string;
  NODE_ENV: string;
  SALT_ROUNDS: number;
  JWT_SECRET: string;
  JWT_EXPIRATION_TIME: number;
  REFRESH_TOKEN_SECRET: string;
  REFRESH_TOKEN_EXPIRATION_TIME: number;
  EMAIL_HOST: string;
  EMAIL_PORT: number;
  EMAIL_USER: string;
  EMAIL_PASSWORD: string;
  EMAIL_FROM: string;
  MAX_JSON_SIZE: string;
  MAX_FILE_SIZE: number;
  URL_ENCODED: boolean;
  REQUEST_LIMIT_TIME: number;
  REQUEST_LIMIT_NUMBER: number;
  WEB_CACHE: boolean;
  STORAGE_PROVIDER: 'local' | 'cloudinary';
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  EXPRESS_FILE_UPLOAD_CONFIG: object;
}

const config: Config = {
  BASE_URL: env.BASE_URL,
  PORT: env.PORT,
  DATABASE_URL: env.DATABASE_URL,
  NODE_ENV: env.NODE_ENV,
  SALT_ROUNDS: env.SALT_ROUNDS,
  JWT_SECRET: jwtSecret,
  JWT_EXPIRATION_TIME: env.JWT_EXPIRATION_TIME,
  REFRESH_TOKEN_SECRET: refreshTokenSecret,
  REFRESH_TOKEN_EXPIRATION_TIME: env.REFRESH_TOKEN_EXPIRATION_TIME,
  EMAIL_HOST: env.EMAIL_HOST || (process.env.SMTP_HOST as string) || '',
  EMAIL_PORT: env.EMAIL_PORT,
  EMAIL_USER: env.EMAIL_USER || (process.env.SMTP_USER as string) || '',
  EMAIL_PASSWORD: env.EMAIL_PASSWORD || (process.env.SMTP_PASS as string) || '',
  EMAIL_FROM: env.EMAIL_FROM || (process.env.SMTP_FROM as string) || env.EMAIL_USER || '',
  MAX_JSON_SIZE: env.MAX_JSON_SIZE,
  MAX_FILE_SIZE: env.MAX_FILE_SIZE,
  URL_ENCODED: env.URL_ENCODED,
  REQUEST_LIMIT_TIME: env.REQUEST_LIMIT_TIME,
  REQUEST_LIMIT_NUMBER: env.REQUEST_LIMIT_NUMBER,
  WEB_CACHE: env.WEB_CACHE,
  STORAGE_PROVIDER: env.STORAGE_PROVIDER,
  CLOUDINARY_CLOUD_NAME: env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: env.CLOUDINARY_API_SECRET,
  EXPRESS_FILE_UPLOAD_CONFIG: {
    createParentPath: true,
    preserveExtension: true,
    limits: {
      fileSize: env.MAX_FILE_SIZE,
    },
  },
};

export default config;
