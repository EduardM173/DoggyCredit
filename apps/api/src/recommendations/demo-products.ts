export const demoProducts = [
  {
    name: "Microcrédito Emprendedor",
    category: "MICRO_CREDIT",
    applicantScope: "PERSON",
    minAmount: "5000",
    maxAmount: "50000",
    purposes: ["WORKING_CAPITAL", "BUSINESS_INVESTMENT"],
  },
  {
    name: "Crédito Verde",
    category: "GREEN_CREDIT",
    applicantScope: "PERSON",
    minAmount: "10000",
    maxAmount: "80000",
    purposes: ["GREEN_PROJECT"],
  },
  {
    name: "Pyme Crece",
    category: "SME_CREDIT",
    applicantScope: "COMPANY",
    minAmount: "20000",
    maxAmount: "150000",
    purposes: ["WORKING_CAPITAL", "BUSINESS_INVESTMENT"],
  },
] as const;
