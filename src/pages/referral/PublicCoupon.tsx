import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import CouponQr from "../../components/referral/CouponQr";
import { getPublicCoupon, type PublicCoupon as Coupon } from "../../referral/coupons";

const LABEL={available:"Disponible",used:"Utilizado",expired:"Vencido",invalid:"No válido"} as const;
export default function PublicCoupon() { const { publicToken="" }=useParams(); const [coupon,setCoupon]=useState<Coupon|null>(null); const [loading,setLoading]=useState(true);
  useEffect(()=>{let mounted=true; void getPublicCoupon(publicToken).then((value)=>mounted&&setCoupon(value)).catch(()=>mounted&&setCoupon(null)).finally(()=>mounted&&setLoading(false)); return()=>{mounted=false;};},[publicToken]);
  const validationUrl=`${window.location.origin}/validate-coupon/${encodeURIComponent(publicToken)}`;
  return <main className="coupon-public"><section className="coupon-card">{loading?<p>Cargando cupón…</p>:!coupon?<><h1>Cupón no válido</h1><p>No pudimos encontrar este cupón.</p></>:<><p className="coupon-eyebrow">{coupon.campaign_name}</p><h1>${(coupon.discount_cents/100).toFixed(0)} de descuento</h1><span className={`coupon-status coupon-${coupon.public_status}`}>{LABEL[coupon.public_status]}</span><CouponQr value={validationUrl}/><p className="coupon-code">{coupon.code}</p><p>Muestra este QR al cajero antes de pagar.</p>{coupon.expires_at?<p>Vence: {new Intl.DateTimeFormat("es-US",{dateStyle:"long"}).format(new Date(coupon.expires_at))}</p>:null}{coupon.terms?<p className="coupon-terms">{coupon.terms}</p>:null}<p className="coupon-notice">Este cupón aplica únicamente en compras realizadas en tienda. No aplica a pedidos con delivery.</p></>}</section></main>;
}
