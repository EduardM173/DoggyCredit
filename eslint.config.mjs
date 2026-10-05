import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// Logical capabilities, including documented boundaries not implemented yet.
const capabilities = [
  "identity-tenants",
  "clients",
  "evaluations",
  "financial-integrations",
  "financial-profile",
  "recommendations",
  "plans-metering",
  "audit",
];

const boundaryRules = [null, ...capabilities].map((owner) => ({
  files: [owner ? `apps/api/src/${owner}/**/*.ts` : "apps/api/src/**/*.ts"],
  ignores: owner ? [] : capabilities.map((name) => `apps/api/src/${name}/**`),
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: capabilities
          .filter((name) => name !== owner)
          .map((name) => ({
            regex: `(?:^|/)${name}/(?!(?:public|${name}\\.module)\\.js$)`,
            message: "Use the capability's module entry point and explicit public.js interface.",
          })),
      },
    ],
  },
}));

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "node_modules-interrupted/**",
      "apps/api/src/generated/**",
      "Data base/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.cjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/api/**/*.ts", "prisma/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  ...boundaryRules,
  {
    files: ["apps/api/src/{infrastructure,common,config}/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `(?:^|/)(?:${capabilities.join("|")})(?:/|$)`,
              message: "Technical infrastructure must not depend on business capabilities.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "apps/api/src/**/*.controller.ts",
      "apps/api/src/**/*.dto.ts",
      "apps/api/src/**/*.contract.ts",
      "apps/api/src/**/public.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value=/prisma|^pg$|^postgres$/]",
          message: "Keep persistence out of controllers, HTTP DTOs and application/public contracts.",
        },
        {
          selector: "ExportNamedDeclaration[source.value=/prisma|^pg$|^postgres$/]",
          message: "Do not expose persistence through public contracts.",
        },
        {
          selector: "ExportAllDeclaration[source.value=/prisma|^pg$|^postgres$/]",
          message: "Do not expose persistence through public contracts.",
        },
      ],
    },
  },
  {
    files: ["apps/api/src/**/*.contract.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex:
                "@nestjs|prisma|infrastructure|class-validator|class-transformer|express|\\.dto\\.js$|\\.controller\\.js$",
              message: "Application contracts must stay independent of transport and infrastructure.",
            },
            ...capabilities.map((name) => ({
              regex: `(?:^|/)${name}/(?!public\\.js$)`,
              message: "Contracts can only consume another capability's public interface.",
            })),
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  prettier,
);
