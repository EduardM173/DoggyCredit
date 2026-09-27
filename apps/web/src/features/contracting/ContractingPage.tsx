import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  Info,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import QRCode from "qrcode";
import { Brand } from "../../components/Brand";
import { plans as interests } from "../institution-requests/api";
import {
  CommerceError,
  commerceApi,
  money,
  methods,
  paymentLabels,
  type Context,
  type Checkout,
  type Payment,
} from "./api";

export function ContractingPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token"));
  const bootstrap = useRef<Promise<unknown> | null>(null);
  const [data, setData] = useState<Context | null>(null);
  const [planId, setPlanId] = useState("");
  const [method, setMethod] = useState<Payment["method"] | "">("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeOperation = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [qr, setQr] = useState("");
  const key = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    window.history.replaceState(null, "", window.location.pathname);
    if (!bootstrap.current)
      bootstrap.current = token ? commerceApi("/contracting/access", { body: { token } }) : Promise.resolve();
    bootstrap.current
      .then(() => commerceApi<Context>("/contracting/context"))
      .then((result) => {
        if (!active) return;
        setData(result);
        const suggested = result.plans.find((plan) => plan.code === result.institution.planInterest);
        if (suggested) setPlanId(suggested.id);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [token, attempt]);
  const payment = data?.contracting?.payment;
  useEffect(() => {
    if (payment?.status !== "PENDING") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const current = await commerceApi<{
          contractingStatus: "PENDING_PAYMENT" | "CONFIRMED";
          confirmedAt: string | null;
          payment: Payment;
        }>("/contracting/payment/status", { signal: controller.signal });
        if (controller.signal.aborted) return;
        setData((previous) =>
          previous?.contracting
            ? {
                ...previous,
                contracting: {
                  ...previous.contracting,
                  status: current.contractingStatus,
                  confirmedAt: current.confirmedAt,
                  payment: current.payment,
                },
              }
            : previous,
        );
        if (current.payment.status !== "PENDING") {
          setCheckout(null);
          return;
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "No se pudo actualizar el estado.");
        if (e instanceof CommerceError && [401, 403, 409].includes(e.status)) return;
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    }
    timer = setTimeout(poll, 3000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [payment?.id, payment?.status]);
  useEffect(() => {
    let active = true;
    if (checkout)
      QRCode.toDataURL(checkout.checkoutUrl, { width: 280, margin: 4, errorCorrectionLevel: "M" })
        .then((value) => {
          if (active) setQr(value);
        })
        .catch(() => {
          if (active) setError("No se pudo generar el QR. Puedes abrir el enlace de demo.");
        });
    return () => {
      active = false;
    };
  }, [checkout]);
  async function run(operation: () => Promise<void>) {
    if (activeOperation.current) return;
    activeOperation.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
    } finally {
      activeOperation.current = false;
      setBusy(false);
    }
  }
  const confirm = () =>
    run(async () => {
      setData(await commerceApi<Context>("/contracting/plan", { body: { planId } }));
    });
  const startPayment = () =>
    run(async () => {
      if (!method) return;
      key.current ??= crypto.randomUUID();
      const result = await commerceApi<Context>("/contracting/payment", {
        body: { method },
        key: key.current,
      });
      setData(result);
      if (result.contracting?.payment?.status === "PENDING" && method !== "BANK_TRANSFER")
        setCheckout(await commerceApi<Checkout>("/contracting/payment/checkout", { body: {} }));
    });
  const generateCheckout = () =>
    run(async () => {
      setQr("");
      setCheckout(await commerceApi<Checkout>("/contracting/payment/checkout", { body: {} }));
    });
  const retry = () => {
    key.current = null;
    setCheckout(null);
    setMethod("");
    setData((previous) =>
      previous?.contracting
        ? { ...previous, contracting: { ...previous.contracting, payment: null } }
        : previous,
    );
  };
  const contract = data?.contracting;
  const confirmed = contract?.status === "CONFIRMED";
  const step = !contract ? 1 : confirmed ? 3 : 2;
  const title = !contract
    ? "Continúa tu contratación en"
    : confirmed
      ? "Tu contratación está confirmada en"
      : payment
        ? "Estado de tu pago en"
        : "Selecciona tu método de pago en";
  return (
    <div className="commerce-page">
      <header className="commerce-header">
        <Brand dark />
        <Link to="/">
          <ArrowLeft size={18} />
          Volver al inicio
        </Link>
      </header>
      <main className="commerce-main">
        <section className="commerce-intro">
          <p className="commerce-eyebrow">CONTRATACIÓN</p>
          <h1>
            {title} <span>DoggyCredit</span>
          </h1>
          <p>
            {confirmed
              ? "La contratación está confirmada. El aprovisionamiento del servicio será el siguiente paso."
              : "Tu solicitud ha sido aprobada. Confirma el plan definitivo para continuar con la contratación."}
          </p>
          {data && (
            <>
              <div className="commerce-institution">
                <Building2 />
                <div>
                  <h2>{data.institution.institutionName}</h2>
                  <p>{confirmed ? "Contratación confirmada" : "Solicitud aprobada"}</p>
                </div>
              </div>
              <dl className="commerce-contact">
                <div>
                  <dt>Nombre</dt>
                  <dd>{data.institution.contactName}</dd>
                </div>
                <div>
                  <dt>Correo</dt>
                  <dd>{data.institution.contactEmail}</dd>
                </div>
              </dl>
            </>
          )}
          <div className="commerce-note">
            <ShieldCheck />
            <p>
              {!contract
                ? "El plan de interés registrado fue solo referencial. El plan definitivo se confirma en este paso."
                : "DoggyCredit no solicita datos de tarjetas ni credenciales bancarias."}
            </p>
          </div>
          <ol className="commerce-steps">
            {["Plan", "Pago", "Confirmación"].map((label, i) => (
              <li className={step >= i + 1 ? "is-current" : ""} key={label}>
                <span>{step > i + 1 ? <Check size={18} /> : i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
        </section>
        <section className="commerce-flow" aria-live="polite">
          {!data ? (
            <>
              <h2>Contratación</h2>
              {!error && <p role="status">Comprobando acceso...</p>}
            </>
          ) : (
            <>
              <p className="commerce-badge">
                <Check size={18} />
                {confirmed ? "CONTRATACIÓN CONFIRMADA" : "SOLICITUD APROBADA"}
              </p>
              {!contract ? (
                <>
                  <h2>Confirma tu plan</h2>
                  <p>Selecciona el plan que deseas contratar para {data.institution.institutionName}.</p>
                  <div className="commerce-note">
                    <Info />
                    <p>
                      Plan de interés registrado:{" "}
                      <strong>
                        {interests.find((p) => p.value === data.institution.planInterest)?.label ??
                          "No indicado"}
                      </strong>
                      . Dato referencial.
                    </p>
                  </div>
                  <fieldset className="commerce-options">
                    <legend>Planes disponibles</legend>
                    {data.plans.map((plan) => (
                      <label key={plan.id} className={planId === plan.id ? "is-selected" : ""}>
                        <input
                          type="radio"
                          name="commercial-plan"
                          value={plan.id}
                          checked={planId === plan.id}
                          disabled={busy}
                          onChange={() => setPlanId(plan.id)}
                        />
                        <div>
                          <strong>Plan {plan.name}</strong>
                          <b>{money(plan.price, plan.currency)} / mes</b>
                        </div>
                        <ul>
                          {plan.features.map((feature) => (
                            <li key={feature}>
                              <Check size={15} />
                              {feature}
                            </li>
                          ))}
                        </ul>
                      </label>
                    ))}
                  </fieldset>
                  {!data.plans.length && <p>No hay planes comerciales disponibles.</p>}
                  <button className="button commerce-primary" disabled={!planId || busy} onClick={confirm}>
                    {busy ? "Confirmando..." : "Continuar con la contratación"}
                    <ArrowRight size={19} />
                  </button>
                  <p className="commerce-muted">
                    Si el plan no requiere pago, pasarás directamente a la confirmación.
                  </p>
                </>
              ) : (
                <>
                  <h2>
                    {confirmed
                      ? payment
                        ? "Pago confirmado"
                        : "Contratación confirmada"
                      : payment
                        ? paymentLabels[payment.status]
                        : "Elige tu método de pago"}
                  </h2>
                  <dl className="commerce-summary">
                    <div>
                      <dt>Plan {confirmed ? "contratado" : "seleccionado"}</dt>
                      <dd>{contract.planName}</dd>
                    </div>
                    <div>
                      <dt>Facturación</dt>
                      <dd>{contract.billingPeriod === "MONTHLY" ? "Mensual" : contract.billingPeriod}</dd>
                    </div>
                    <div>
                      <dt>Importe</dt>
                      <dd>{money(contract.price, contract.currency)} / mes</dd>
                    </div>
                    {payment && (
                      <div>
                        <dt>Método</dt>
                        <dd>{methods[payment.method]}</dd>
                      </div>
                    )}
                  </dl>
                  {!confirmed && (
                    <div className="commerce-simulation">
                      <strong>ENTORNO DE SIMULACIÓN</strong>
                      <span>No se procesará dinero real.</span>
                    </div>
                  )}
                  {!payment && !confirmed ? (
                    <>
                      <fieldset className="commerce-options commerce-methods">
                        <legend>Método de pago</legend>
                        {(Object.keys(methods) as Payment["method"][]).map((value) => (
                          <label key={value} className={method === value ? "is-selected" : ""}>
                            <input
                              name="payment-method"
                              type="radio"
                              checked={method === value}
                              disabled={busy}
                              onChange={() => {
                                setMethod(value);
                                key.current = null;
                              }}
                            />
                            {value === "QR" ? <QrCode /> : value === "CARD" ? <CreditCard /> : <Building2 />}
                            <div>
                              <strong>{methods[value]}</strong>
                              <p>
                                {value === "BANK_TRANSFER"
                                  ? "El operador confirmará el caso de prueba desde Administración."
                                  : "Completa el pago simulado en DoggyPay Demo."}
                              </p>
                            </div>
                          </label>
                        ))}
                      </fieldset>
                      <button
                        className="button commerce-primary"
                        disabled={!method || busy || data.paymentProvider !== "mock"}
                        onClick={startPayment}
                      >
                        {busy ? "Iniciando..." : "Continuar al pago"}
                        <ArrowRight size={19} />
                      </button>
                    </>
                  ) : payment ? (
                    <>
                      <div className={`commerce-payment-state state-${payment.status}`}>
                        {confirmed ? <CheckCircle2 size={42} /> : <Clock3 size={42} />}
                        <div>
                          <strong>{paymentLabels[payment.status]}</strong>
                          <p>
                            Referencia: <b>{payment.reference}</b>
                          </p>
                          <p>
                            {payment.resolvedAt ? "Fecha de resolución" : "Fecha de registro"}:{" "}
                            {new Date(payment.resolvedAt ?? payment.createdAt).toLocaleString("es-BO")}
                          </p>
                        </div>
                      </div>
                      {payment.status === "PENDING" && (
                        <>
                          {payment.method === "BANK_TRANSFER" ? (
                            <p>
                              Transferencia ficticia: no realices ningún depósito. Un operador puede simular
                              el resultado desde Contrataciones.
                            </p>
                          ) : (
                            <>
                              {checkout ? (
                                <div className="commerce-checkout">
                                  {payment.method === "QR" && qr && (
                                    <img
                                      src={qr}
                                      alt="QR de checkout DoggyPay Demo"
                                      width={280}
                                      height={280}
                                    />
                                  )}
                                  <a
                                    className="button commerce-secondary"
                                    href={checkout.checkoutUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Abrir DoggyPay Demo
                                    <ArrowRight size={18} />
                                  </a>
                                  <small>
                                    El enlace vence a las{" "}
                                    {new Date(checkout.expiresAt).toLocaleTimeString("es-BO")}.
                                  </small>
                                </div>
                              ) : null}
                              <button
                                className="button commerce-secondary"
                                disabled={busy}
                                onClick={generateCheckout}
                              >
                                <RefreshCw size={17} />
                                {checkout ? "Generar nuevo enlace / QR" : "Generar enlace / QR"}
                              </button>
                            </>
                          )}
                          <p className="commerce-muted">
                            El estado se actualizará cuando recibamos la confirmación del proveedor simulado.
                          </p>
                          {!payment.initialized && (
                            <button
                              className="button commerce-secondary"
                              disabled={busy}
                              onClick={() => {
                                setMethod(payment.method);
                                void run(async () => {
                                  key.current ??= crypto.randomUUID();
                                  setData(
                                    await commerceApi<Context>("/contracting/payment", {
                                      body: { method: payment.method },
                                      key: key.current,
                                    }),
                                  );
                                });
                              }}
                            >
                              Reintentar inicialización
                            </button>
                          )}
                        </>
                      )}
                      {(payment.status === "FAILED" || payment.status === "CANCELLED") && (
                        <>
                          <p>
                            La contratación sigue pendiente. Puedes iniciar un nuevo intento; el anterior
                            permanecerá registrado.
                          </p>
                          <button className="button commerce-primary" onClick={retry}>
                            Reintentar pago
                            <ArrowRight size={18} />
                          </button>
                        </>
                      )}
                    </>
                  ) : null}
                  {confirmed && (
                    <>
                      <div className="commerce-note">
                        <CheckCircle2 />
                        <p>
                          {payment ? "Pago simulado confirmado." : "Este plan no requiere pago."} La
                          contratación continuará con el aprovisionamiento del servicio. Todavía no se ha
                          creado el espacio institucional.
                        </p>
                      </div>
                      <Link className="button commerce-secondary" to="/">
                        Entendido
                      </Link>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {error && (
            <div className="commerce-error" role="alert">
              <p>{error}</p>
              <button
                className="button commerce-secondary"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setAttempt((value) => value + 1);
                }}
              >
                Actualizar estado
              </button>
            </div>
          )}
        </section>
      </main>
      <footer className="commerce-footer">
        <Brand />
        <span>DoggyCredit · Contratación institucional</span>
      </footer>
    </div>
  );
}
