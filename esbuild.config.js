const { build } = require('esbuild');
const esbuildPluginTsc = require('esbuild-plugin-tsc');

build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  platform: 'node',
  target: 'node22',
  outfile: 'dist/main.js',
  format: 'cjs',
  sourcemap: true,
  // We need to keep names for NestJS Dependency Injection
  keepNames: true,
  // Do not bundle node_modules. This is crucial for NestJS native dependencies.
  external: [
    '@nestjs/*',
    'bcrypt',
    'class-transformer',
    'class-validator',
    'express',
    'helmet',
    'ioredis',
    'nodemailer',
    'passport*',
    'pdfmake',
    'prisma',
    '@prisma/client',
    'reflect-metadata',
    'rxjs',
    'swagger-ui-express'
  ],
  plugins: [esbuildPluginTsc({
    tsconfigPath: 'tsconfig.build.json'
  })],
}).catch(() => process.exit(1));
