import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CreditCard,
  Info,
  Leaf,
  Plus,
  User,
  Users,
  X,
} from "lucide-react";
import {
  institutionApi,
  InstitutionError,
  type ApplicantScope,
  type CreateProductPayload,
  type CreditPurpose,
  type DeactivationImpactResponse,
  type ProductCatalogItem,
  type ProductCategory,
  type UpdateProductPayload,
} from "./api";
import "./products.css";

const PURPOSE_LABELS: Record<CreditPurpose, string> = {
  WORKING_CAPITAL: "Capital de trabajo",
  BUSINESS_INVESTMENT: "Inversión de capital",
  GREEN_PROJECT: "Proyecto verde / sostenible",
  EQUIPMENT: "Equipamiento y maquinaria",
  OTHER: "Otra finalidad comercial",
};

const CATEGORY_LABELS: Record<ProductCategory, string> = {
  MICRO_CREDIT: "Microcrédito",
  GREEN_CREDIT: "Crédito Verde",
  SME_CREDIT: "Crédito PyME",
  OTHER: "Crédito General",
};

const SCOPE_LABELS: Record<ApplicantScope, string> = {
  PERSON: "Personas",
  COMPANY: "Empresas",
  BOTH: "Personas y Empresas",
};

export function ProductsCatalogPanel({
  slug,
  admin,
  initialProducts,
  selectedProductIds,
  onSelectProduct,
  onProductsChanged,
}: {
  slug: string;
  tenantName: string;
  admin: boolean;
  initialProducts?: ProductCatalogItem[] | Array<Record<string, unknown>>;
  selectedProductIds?: string[];
  onSelectProduct?: (productId: string) => void;
  onProductsChanged?: () => void;
}) {
  const [products, setProducts] = useState<ProductCatalogItem[]>(() =>
    initialProducts && Array.isArray(initialProducts)
      ? (initialProducts as Array<Record<string, unknown>>).map((p) => ({
          id: String(p.id ?? ""),
          tenantId: String(p.tenantId ?? ""),
          name: String(p.name ?? ""),
          category: (p.category ?? "MICRO_CREDIT") as ProductCategory,
          applicantScope: (p.applicantScope ?? "PERSON") as ApplicantScope,
          minAmount: Number(p.minAmount),
          maxAmount: Number(p.maxAmount),
          maxDebtToIncome:
            p.maxDebtToIncome != null ? Number(p.maxDebtToIncome) : null,
          minMonthlyDisposableIncome:
            p.minMonthlyDisposableIncome != null
              ? Number(p.minMonthlyDisposableIncome)
              : null,
          allowsRecentArrears: Boolean(p.allowsRecentArrears),
          active: Boolean(p.active ?? p.selected ?? true),
          purposes: (p.purposes as CreditPurpose[]) ?? [],
          createdAt: String(p.createdAt ?? ""),
          updatedAt: String(p.updatedAt ?? ""),
        }))
      : [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductCatalogItem | null>(null);

  // Form Fields
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState<ProductCategory>("MICRO_CREDIT");
  const [formScope, setFormScope] = useState<ApplicantScope>("PERSON");
  const [formPurposes, setFormPurposes] = useState<CreditPurpose[]>([
    "WORKING_CAPITAL",
  ]);
  const [formMinAmount, setFormMinAmount] = useState<number | "">(1000);
  const [formMaxAmount, setFormMaxAmount] = useState<number | "">(50000);
  const [formMaxDti, setFormMaxDti] = useState<string>("");
  const [formMinDisposableIncome, setFormMinDisposableIncome] = useState<string>("");
  const [formAllowsRecentArrears, setFormAllowsRecentArrears] = useState(false);
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Deactivation Impact Warning Modal State (PA-16.04)
  const [warningModalOpen, setWarningModalOpen] = useState(false);
  const [impactTargetProduct, setImpactTargetProduct] =
    useState<ProductCatalogItem | null>(null);
  const [impactWarningMessage, setImpactWarningMessage] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    institutionApi<ProductCatalogItem[]>(
      `/tenants/${encodeURIComponent(slug)}/products/catalog`,
    )
      .then((data) => {
        if (!active) return;
        const dataObj = data as unknown as { products?: Array<Record<string, unknown>> };
        const list: ProductCatalogItem[] = Array.isArray(data)
          ? data
          : Array.isArray(dataObj?.products)
            ? dataObj.products.map((p) => ({
                id: String(p.id ?? ""),
                tenantId: String(p.tenantId ?? ""),
                name: String(p.name ?? ""),
                category: (p.category ?? "MICRO_CREDIT") as ProductCategory,
                applicantScope: (p.applicantScope ?? "PERSON") as ApplicantScope,
                minAmount: Number(p.minAmount),
                maxAmount: Number(p.maxAmount),
                maxDebtToIncome:
                  p.maxDebtToIncome != null ? Number(p.maxDebtToIncome) : null,
                minMonthlyDisposableIncome:
                  p.minMonthlyDisposableIncome != null
                    ? Number(p.minMonthlyDisposableIncome)
                    : null,
                allowsRecentArrears: Boolean(p.allowsRecentArrears),
                active: Boolean(p.active ?? p.selected ?? true),
                purposes: (p.purposes as CreditPurpose[]) ?? [],
                createdAt: String(p.createdAt ?? ""),
                updatedAt: String(p.updatedAt ?? ""),
              }))
            : initialProducts && Array.isArray(initialProducts)
              ? (initialProducts as Array<Record<string, unknown>>).map((p) => ({
                  id: String(p.id ?? ""),
                  tenantId: String(p.tenantId ?? ""),
                  name: String(p.name ?? ""),
                  category: (p.category ?? "MICRO_CREDIT") as ProductCategory,
                  applicantScope: (p.applicantScope ?? "PERSON") as ApplicantScope,
                  minAmount: Number(p.minAmount),
                  maxAmount: Number(p.maxAmount),
                  maxDebtToIncome:
                    p.maxDebtToIncome != null ? Number(p.maxDebtToIncome) : null,
                  minMonthlyDisposableIncome:
                    p.minMonthlyDisposableIncome != null
                      ? Number(p.minMonthlyDisposableIncome)
                      : null,
                  allowsRecentArrears: Boolean(p.allowsRecentArrears),
                  active: Boolean(p.active ?? p.selected ?? true),
                  purposes: (p.purposes as CreditPurpose[]) ?? [],
                  createdAt: String(p.createdAt ?? ""),
                  updatedAt: String(p.updatedAt ?? ""),
                }))
              : [];
        setLoading(false);
        setProducts(list);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (initialProducts && initialProducts.length > 0) {
          setProducts(
            (initialProducts as Array<Record<string, unknown>>).map((p) => ({
              id: String(p.id ?? ""),
              tenantId: String(p.tenantId ?? ""),
              name: String(p.name ?? ""),
              category: (p.category ?? "MICRO_CREDIT") as ProductCategory,
              applicantScope: (p.applicantScope ?? "PERSON") as ApplicantScope,
              minAmount: Number(p.minAmount),
              maxAmount: Number(p.maxAmount),
              maxDebtToIncome:
                p.maxDebtToIncome != null ? Number(p.maxDebtToIncome) : null,
              minMonthlyDisposableIncome:
                p.minMonthlyDisposableIncome != null
                  ? Number(p.minMonthlyDisposableIncome)
                  : null,
              allowsRecentArrears: Boolean(p.allowsRecentArrears),
              active: Boolean(p.active ?? p.selected ?? true),
              purposes: (p.purposes as CreditPurpose[]) ?? [],
              createdAt: String(p.createdAt ?? ""),
              updatedAt: String(p.updatedAt ?? ""),
            })),
          );
        } else {
          setError(
            err instanceof Error ? err.message : "Error al cargar el catálogo de productos.",
          );
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug, initialProducts, reloadVersion]);

  function handleOpenCreate() {
    setEditingProduct(null);
    setFormName("");
    setFormCategory("MICRO_CREDIT");
    setFormScope("PERSON");
    setFormPurposes(["WORKING_CAPITAL"]);
    setFormMinAmount(1000);
    setFormMaxAmount(50000);
    setFormMaxDti("");
    setFormMinDisposableIncome("");
    setFormAllowsRecentArrears(false);
    setFormActive(true);
    setFormError("");
    setModalOpen(true);
  }

  function handleOpenEdit(product: ProductCatalogItem) {
    setEditingProduct(product);
    setFormName(product.name);
    setFormCategory(product.category);
    setFormScope(product.applicantScope);
    setFormPurposes(product.purposes.length > 0 ? product.purposes : ["WORKING_CAPITAL"]);
    setFormMinAmount(product.minAmount);
    setFormMaxAmount(product.maxAmount);
    setFormMaxDti(
      product.maxDebtToIncome !== null ? (product.maxDebtToIncome * 100).toString() : "",
    );
    setFormMinDisposableIncome(
      product.minMonthlyDisposableIncome !== null
        ? product.minMonthlyDisposableIncome.toString()
        : "",
    );
    setFormAllowsRecentArrears(product.allowsRecentArrears);
    setFormActive(product.active);
    setFormError("");
    setModalOpen(true);
  }

  function handleTogglePurpose(purpose: CreditPurpose) {
    setFormPurposes((prev) =>
      prev.includes(purpose)
        ? prev.filter((p) => p !== purpose)
        : [...prev, purpose],
    );
  }

  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    setFormError("");

    const trimmedName = formName.trim();
    if (!trimmedName) {
      setFormError("Introduce el nombre del producto crediticio.");
      return;
    }

    if (formMinAmount === "" || Number(formMinAmount) <= 0) {
      setFormError("El monto mínimo debe ser mayor a cero.");
      return;
    }

    if (formMaxAmount === "" || Number(formMaxAmount) < Number(formMinAmount)) {
      setFormError("El monto máximo no puede ser inferior al monto mínimo.");
      return;
    }

    if (formPurposes.length === 0) {
      setFormError("Debes seleccionar al menos una finalidad para el producto.");
      return;
    }

    const parsedDti =
      formMaxDti.trim() !== "" ? Number(formMaxDti) / 100 : undefined;
    if (parsedDti !== undefined && (isNaN(parsedDti) || parsedDti <= 0 || parsedDti > 1)) {
      setFormError("La relación deuda/ingreso máxima debe estar entre 1% y 100%.");
      return;
    }

    const parsedMinIncome =
      formMinDisposableIncome.trim() !== ""
        ? Number(formMinDisposableIncome)
        : undefined;
    if (parsedMinIncome !== undefined && (isNaN(parsedMinIncome) || parsedMinIncome < 0)) {
      setFormError("El ingreso mensual disponible no puede ser negativo.");
      return;
    }

    setSaving(true);
    try {
      if (editingProduct) {
        const payload: UpdateProductPayload = {
          name: trimmedName,
          category: formCategory,
          applicantScope: formScope,
          purposes: formPurposes,
          minAmount: Number(formMinAmount),
          maxAmount: Number(formMaxAmount),
          maxDebtToIncome: parsedDti !== undefined ? parsedDti : null,
          minMonthlyDisposableIncome:
            parsedMinIncome !== undefined ? parsedMinIncome : null,
          allowsRecentArrears: formAllowsRecentArrears,
          active: formActive,
        };
        await institutionApi(
          `/tenants/${encodeURIComponent(slug)}/products/catalog/${encodeURIComponent(editingProduct.id)}`,
          { method: "PUT", body: payload },
        );
        setSuccessMsg(`Producto "${trimmedName}" actualizado correctamente.`);
      } else {
        const payload: CreateProductPayload = {
          name: trimmedName,
          category: formCategory,
          applicantScope: formScope,
          purposes: formPurposes,
          minAmount: Number(formMinAmount),
          maxAmount: Number(formMaxAmount),
          maxDebtToIncome: parsedDti,
          minMonthlyDisposableIncome: parsedMinIncome,
          allowsRecentArrears: formAllowsRecentArrears,
          active: formActive,
        };
        await institutionApi(
          `/tenants/${encodeURIComponent(slug)}/products/catalog`,
          { method: "POST", body: payload },
        );
        setSuccessMsg(`Producto "${trimmedName}" agregado al catálogo.`);
      }

      setModalOpen(false);
      setReloadVersion((v) => v + 1);
      onProductsChanged?.();
    } catch (err) {
      // CA-16.04: Preserves entered valid fields on error!
      if (err instanceof InstitutionError) {
        setFormError(err.message);
      } else {
        setFormError(
          err instanceof Error
            ? err.message
            : "No se pudo guardar el producto crediticio.",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleStatus(product: ProductCatalogItem) {
    onSelectProduct?.(product.id);
    if (product.active) {
      // Check deactivation impact before disabling
      try {
        const impact = await institutionApi<DeactivationImpactResponse>(
          `/tenants/${encodeURIComponent(slug)}/products/catalog/${encodeURIComponent(product.id)}/deactivation-impact`,
        );
        if (impact.isLastActive) {
          // Open warning confirmation modal (PA-16.04, CA-16.08, CA-16.12)
          setImpactTargetProduct(product);
          setImpactWarningMessage(
            impact.warningMessage ||
              "Este es el único producto activo aplicable a Empresa. Si lo desactivas, tu institución no estará preparada para realizar evaluaciones crediticias empresariales y las nuevas solicitudes para empresas quedarán bloqueadas.",
          );
          setWarningModalOpen(true);
          return;
        }
      } catch {
        // Fallback: continue to toggle
      }

      await executeToggleStatus(product.id, false, false);
    } else {
      // Activating product
      await executeToggleStatus(product.id, true, false);
    }
  }

  async function executeToggleStatus(
    productId: string,
    active: boolean,
    confirmImpact = false,
  ) {
    try {
      await institutionApi(
        `/tenants/${encodeURIComponent(slug)}/products/catalog/${encodeURIComponent(productId)}/status`,
        {
          method: "PATCH",
          body: { active, confirmImpact },
        },
      );
      setSuccessMsg(
        active ? "Producto crediticio activado." : "Producto crediticio desactivado.",
      );
      setWarningModalOpen(false);
      setImpactTargetProduct(null);
      setReloadVersion((v) => v + 1);
      onProductsChanged?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al cambiar el estado del producto.",
      );
    }
  }

  return (
    <div className="product-catalog-container">
      <div className="product-catalog-header">
        <div className="product-catalog-title-group">
          <h2>Catálogo de productos crediticios</h2>
          <p>
            Administra los productos de tu institución que participan en las evaluaciones
            y recomendaciones de DoggyCredit.
          </p>
        </div>
        {admin && (
          <button
            type="button"
            className="product-add-btn"
            onClick={handleOpenCreate}
            aria-label="Agregar producto"
          >
            <Plus size={18} />
            Agregar producto
          </button>
        )}
      </div>

      {/* Notificación informativa para Analistas (CA-16.09, PA-16.05) */}
      {!admin && (
        <div className="product-analyst-notice" role="status">
          <Info size={20} />
          <span>
            <strong>Modo de consulta (Analista):</strong> Puedes revisar las condiciones y
            el estado de cada producto. Solo la administración institucional puede crear,
            editar o cambiar el estado de los productos crediticios.
          </span>
        </div>
      )}

      {error && (
        <div className="alert-message error" role="alert">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="alert-message success" role="status">
          <CheckCircle2 size={18} />
          {successMsg}
        </div>
      )}

      {loading ? (
        <p className="loading-state">Cargando catálogo de productos...</p>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <CreditCard size={40} />
          <p>Aún no hay productos crediticios configurados para tu institución.</p>
          {admin && (
            <button
              type="button"
              className="product-add-btn"
              onClick={handleOpenCreate}
            >
              <Plus size={18} />
              Configurar primer producto
            </button>
          )}
        </div>
      ) : (
        <div className="product-catalog-grid">
          {products.map((product) => {
            const isGreen = product.category === "GREEN_CREDIT";
            return (
              <article
                key={product.id}
                className={`product-card ${product.active ? "active" : "inactive"}`}
                data-testid={`product-card-${product.id}`}
              >
                <div>
                  <header className="product-card-header">
                    <div className="product-card-title-group">
                      {admin && (
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${product.name}`}
                          checked={
                            selectedProductIds !== undefined
                              ? selectedProductIds.includes(product.id)
                              : product.active
                          }
                          disabled={saving}
                          onChange={() => handleToggleStatus(product)}
                        />
                      )}
                      <div className={`product-icon-wrap ${isGreen ? "green" : ""}`}>
                        {isGreen ? <Leaf size={22} /> : <CreditCard size={22} />}
                      </div>
                      <div>
                        <h3 className="product-card-name">{product.name}</h3>
                        <span className="product-tag">{CATEGORY_LABELS[product.category]}</span>
                      </div>
                    </div>
                    <span
                      className={`product-status-badge ${
                        product.active ? "active" : "inactive"
                      }`}
                    >
                      {product.active ? "Activo" : "Inactivo"}
                    </span>
                  </header>

                  <div className="product-card-body">
                    <div className="product-amount-range">
                      Bs. {Number(product.minAmount).toLocaleString("es-BO")} – Bs.{" "}
                      {Number(product.maxAmount).toLocaleString("es-BO")}
                    </div>

                    <div className="product-tag-row">
                      <span className="product-tag scope">
                        {product.applicantScope === "COMPANY" ? (
                          <Building2 size={13} style={{ marginRight: 4 }} />
                        ) : product.applicantScope === "PERSON" ? (
                          <User size={13} style={{ marginRight: 4 }} />
                        ) : (
                          <Users size={13} style={{ marginRight: 4 }} />
                        )}
                        {SCOPE_LABELS[product.applicantScope]}
                      </span>

                      {product.purposes.map((purpose) => (
                        <span key={purpose} className="product-tag">
                          {PURPOSE_LABELS[purpose] ?? purpose}
                        </span>
                      ))}
                    </div>

                    <div className="product-criteria-list">
                      <div className="product-criteria-item">
                        <span>DTI Máximo:</span>
                        <strong>
                          {product.maxDebtToIncome !== null
                            ? `${(product.maxDebtToIncome * 100).toFixed(0)}%`
                            : "Por defecto (40%)"}
                        </strong>
                      </div>
                      <div className="product-criteria-item">
                        <span>Ingreso Mínimo Disponible:</span>
                        <strong>
                          {product.minMonthlyDisposableIncome !== null
                            ? `Bs. ${Number(product.minMonthlyDisposableIncome).toLocaleString("es-BO")}`
                            : "No exigido"}
                        </strong>
                      </div>
                      <div className="product-criteria-item">
                        <span>Historial de mora:</span>
                        <strong>
                          {product.allowsRecentArrears
                            ? "Admite antecedentes"
                            : "Sin mora reciente"}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                {admin && (
                  <footer className="product-card-footer">
                    <button
                      type="button"
                      className="product-btn-edit"
                      onClick={() => handleOpenEdit(product)}
                      aria-label={`Editar ${product.name}`}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className={`product-btn-toggle ${
                        product.active ? "deactivate" : "activate"
                      }`}
                      onClick={() => handleToggleStatus(product)}
                      aria-label={`${product.active ? "Desactivar" : "Activar"} ${
                        product.name
                      }`}
                    >
                      {product.active ? "Desactivar" : "Activar"}
                    </button>
                  </footer>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Modal de Creación / Edición de Producto (CA-16.02, CA-16.03) */}
      {modalOpen && (
        <div className="product-modal-backdrop" role="dialog" aria-modal="true">
          <div className="product-modal">
            <header className="product-modal-header">
              <h3>
                {editingProduct
                  ? "Editar producto crediticio"
                  : "Nuevo producto crediticio"}
              </h3>
              <button
                type="button"
                className="product-modal-close"
                onClick={() => setModalOpen(false)}
                aria-label="Cerrar modal"
              >
                <X size={20} />
              </button>
            </header>

            {formError && (
              <div className="alert-message error" role="alert">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveProduct}>
              <div className="product-form-grid">
                <div className="product-field product-form-full">
                  <label htmlFor="prod-name">Nombre comercial del producto *</label>
                  <input
                    id="prod-name"
                    type="text"
                    required
                    maxLength={160}
                    placeholder="Ej. Crédito Productivo PyME"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                  <p className="product-field-hint">
                    Debe ser un nombre claro y único dentro de tu institución.
                  </p>
                </div>

                <div className="product-field">
                  <label htmlFor="prod-category">Categoría comercial *</label>
                  <select
                    id="prod-category"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as ProductCategory)}
                  >
                    <option value="MICRO_CREDIT">Microcrédito</option>
                    <option value="GREEN_CREDIT">Crédito Verde</option>
                    <option value="SME_CREDIT">Crédito PyME</option>
                    <option value="OTHER">Crédito General / Otro</option>
                  </select>
                </div>

                <div className="product-field">
                  <label htmlFor="prod-scope">Alcance del solicitante *</label>
                  <select
                    id="prod-scope"
                    value={formScope}
                    onChange={(e) => setFormScope(e.target.value as ApplicantScope)}
                  >
                    <option value="PERSON">Solo Personas Naturales (CI)</option>
                    <option value="COMPANY">Solo Empresas / Personas Jurídicas (NIT)</option>
                    <option value="BOTH">Ambos (Personas y Empresas)</option>
                  </select>
                </div>

                <div className="product-field">
                  <label htmlFor="prod-min">Monto mínimo (Bs.) *</label>
                  <input
                    id="prod-min"
                    type="number"
                    min={1}
                    required
                    value={formMinAmount}
                    onChange={(e) =>
                      setFormMinAmount(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                  <p className="product-field-hint">Monto mayor a cero.</p>
                </div>

                <div className="product-field">
                  <label htmlFor="prod-max">Monto máximo (Bs.) *</label>
                  <input
                    id="prod-max"
                    type="number"
                    min={1}
                    required
                    value={formMaxAmount}
                    onChange={(e) =>
                      setFormMaxAmount(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                  <p className="product-field-hint">
                    No puede ser inferior al monto mínimo.
                  </p>
                </div>

                <div className="product-field product-form-full">
                  <label>Finalidades permitidas *</label>
                  <div className="product-purposes-selector">
                    {(
                      [
                        "WORKING_CAPITAL",
                        "BUSINESS_INVESTMENT",
                        "GREEN_PROJECT",
                        "EQUIPMENT",
                        "OTHER",
                      ] as CreditPurpose[]
                    ).map((p) => (
                      <label key={p} className="product-purpose-checkbox">
                        <input
                          type="checkbox"
                          checked={formPurposes.includes(p)}
                          onChange={() => handleTogglePurpose(p)}
                        />
                        <span>{PURPOSE_LABELS[p]}</span>
                      </label>
                    ))}
                  </div>
                  <p className="product-field-hint">
                    Selecciona al menos una finalidad admitida por este producto.
                  </p>
                </div>

                <div className="product-field">
                  <label htmlFor="prod-dti">Relación DTI máxima (%) opcional</label>
                  <input
                    id="prod-dti"
                    type="number"
                    min={1}
                    max={100}
                    placeholder="Ej. 40"
                    value={formMaxDti}
                    onChange={(e) => setFormMaxDti(e.target.value)}
                  />
                  <p className="product-field-hint">
                    Porcentaje máximo de endeudamiento sobre ingresos (deja vacío para
                    regla estándar).
                  </p>
                </div>

                <div className="product-field">
                  <label htmlFor="prod-income">Ingreso disponible mín. (Bs.) opcional</label>
                  <input
                    id="prod-income"
                    type="number"
                    min={0}
                    placeholder="Ej. 2500"
                    value={formMinDisposableIncome}
                    onChange={(e) => setFormMinDisposableIncome(e.target.value)}
                  />
                  <p className="product-field-hint">
                    Ingreso neto mínimo exigido para evaluar compatibilidad.
                  </p>
                </div>

                <div className="product-field product-form-full">
                  <label className="product-checkbox-row">
                    <input
                      type="checkbox"
                      checked={formAllowsRecentArrears}
                      onChange={(e) => setFormAllowsRecentArrears(e.target.checked)}
                    />
                    <span>
                      Admite mora reciente (permite solicitantes con atrasos registrados)
                    </span>
                  </label>
                </div>

                <div className="product-field product-form-full">
                  <label className="product-checkbox-row">
                    <input
                      type="checkbox"
                      checked={formActive}
                      onChange={(e) => setFormActive(e.target.checked)}
                    />
                    <span>
                      Producto activo (disponible para nuevas evaluaciones crediticias)
                    </span>
                  </label>
                </div>
              </div>

              <footer className="product-modal-actions">
                <button
                  type="button"
                  className="product-btn-cancel"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="product-btn-save"
                  disabled={saving}
                >
                  {saving ? "Guardando..." : "Guardar producto"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Advertencia al Desactivar Último Producto (PA-16.04, CA-16.08, CA-16.12) */}
      {warningModalOpen && impactTargetProduct && (
        <div
          className="product-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="warning-modal-title"
        >
          <div className="product-modal product-warning-modal">
            <div className="product-warning-icon-wrap">
              <AlertTriangle size={28} />
            </div>
            <h4 id="warning-modal-title">Advertencia de impacto en nuevas evaluaciones</h4>
            <p>{impactWarningMessage}</p>
            <p style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#64748b" }}>
              Las evaluaciones pasadas conservarán sus resultados y recomendaciones
              intactos, pero los analistas no podrán realizar nuevas evaluaciones para este
              tipo de solicitante hasta que se configure un nuevo producto.
            </p>

            <footer className="product-modal-actions">
              <button
                type="button"
                className="product-btn-cancel"
                onClick={() => {
                  setWarningModalOpen(false);
                  setImpactTargetProduct(null);
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="product-btn-confirm-warning"
                onClick={() =>
                  executeToggleStatus(impactTargetProduct.id, false, true)
                }
              >
                Confirmar desactivación
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
