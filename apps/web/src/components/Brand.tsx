import { Link } from "react-router-dom";

export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <Link className={`brand${dark ? " brand-light" : ""}`} to="/" aria-label="DoggyCredit, inicio">
      <span className={`brand-mark${dark ? " brand-mark-dark" : ""}`} aria-hidden="true">
        <img src={dark ? "/images/landing-reference.png" : "/images/confirmation-reference.png"} alt="" />
      </span>
      <span>
        Doggy<span className="brand-credit">Credit</span>
      </span>
    </Link>
  );
}
