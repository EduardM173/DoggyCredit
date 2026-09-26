import Joi from "joi";

export const environmentValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgres", "postgresql"] })
    .required()
    .messages({ "any.required": "DATABASE_URL is required" }),
  API_PORT: Joi.number().port().default(3000),
  WEB_ORIGIN: Joi.string().uri().required().messages({ "any.required": "WEB_ORIGIN is required" }),
});
