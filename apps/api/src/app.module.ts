import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { environmentValidationSchema } from "./config/environment.js";
import { HealthController } from "./health.controller.js";
import { PrismaModule } from "./infrastructure/prisma/prisma.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
      validationSchema: environmentValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    PrismaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
