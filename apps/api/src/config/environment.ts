import Joi from "joi";

export const environmentValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ["postgres", "postgresql"] })
    .required()
    .messages({ "any.required": "DATABASE_URL is required" }),
  API_PORT: Joi.number().port().default(3000),
  WEB_ORIGIN: Joi.string().uri().required().messages({ "any.required": "WEB_ORIGIN is required" }),
  RESEND_API_KEY: Joi.string()
    .trim()
    .when("NODE_ENV", {
      is: "production",
      then: Joi.required(),
      otherwise: Joi.allow("").optional(),
    }),
  RESEND_FROM_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .when("NODE_ENV", {
      is: "production",
      then: Joi.required(),
      otherwise: Joi.allow("").optional(),
    }),
  PUBLIC_APP_URL: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .custom((value, helpers) => {
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
        return helpers.error("any.invalid");
      if (helpers.state.ancestors[0].NODE_ENV === "production" && url.protocol !== "https:")
        return helpers.error("any.invalid");
      return value;
    })
    .when("NODE_ENV", {
      is: "production",
      then: Joi.required(),
      otherwise: Joi.string().default("http://localhost:5173"),
    }),
  EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: Joi.number().integer().min(1).max(10080).default(30),
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: Joi.number().integer().min(10).max(86400).default(60),
  ADMIN_SESSION_TTL_MINUTES: Joi.number().integer().min(1).max(1440).default(120),
});
