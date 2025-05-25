/******************************************************************************
 * TickMath (JSBI edition) – error-safe                                       *
 * – Accepts  hex / dec / BigNumber / BigInt / JSBI                           *
 * – Works for every value Uniswap v3+v4 can emit (Q64.96)                    *
 ******************************************************************************/
import JSBI from 'jsbi';

export const MAX_TICK = 887272;
export const MIN_TICK = -MAX_TICK;

/* ─────────── fixed-point powers of two (Q constants) ─────────── */
const Q32  = JSBI.leftShift(JSBI.BigInt(1), JSBI.BigInt(32));
const Q96  = JSBI.leftShift(JSBI.BigInt(1), JSBI.BigInt(96));
const Q128 = JSBI.leftShift(JSBI.BigInt(1), JSBI.BigInt(128));

/* pre-computed  (sqrt(1.0001) ^ 2^i) * 2^128  constants */
const MUL_CONSTANTS = [
  '0xfffcb933bd6fad37aa2d162d1a594001', '0xfff97272373d413259a46990580e213a',
  '0xfff2e50f5f656932ef12357cf3c7fdcc', '0xffe5caca7e10e4e61c3624eaa0941cd0',
  '0xffcb9843d60f6159c9db58835c926644', '0xff973b41fa98c081472e6896dfb254c0',
  '0xff2ea16466c96a3843ec78b326b52861', '0xfe5dee046a99a2a811c461f1969c3053',
  '0xfcbe86c7900a88aedcffc83b479aa3a4', '0xf987a7253ac413176f2b074cf7815e54',
  '0xf3392b0822b70005940c7a398e4b70f3', '0xe7159475a2c29b7443b29c7fa6e889d9',
  '0xd097f3bdfd2022b8845ad8f792aa5825', '0xa9f746462d870fdf8a65dc1f90e061e5',
  '0x70d869a156d2a1b890bb3df62baf32f7', '0x31be135f97d08fd981231505542fcfa6',
  '0x9aa508b5b7a84e1c677de54f3e99bc9',  '0x5d6af8dedb81196699c329225ee604',
  '0x2216e584f5fa1ea926041bedfe98',      '0x48a170391f7dc42444e8fa2'
].map(x => JSBI.BigInt(x));

/* ─────────── helper: normalise ANY bigint-ish into JSBI.BigInt ─────────── */
function toJSBI(x) {
  if (x instanceof JSBI) return x;
  if (typeof x === 'string') return x.startsWith('0x')
    ? JSBI.BigInt(BigInt(x).toString())
    : JSBI.BigInt(x);
  if (typeof x === 'object' && 'toString' in x) return JSBI.BigInt(x.toString());
  throw new TypeError('Unsupported bigint-ish value');
}

export function getSqrtRatioAtTick(tick) {
  console.log({tick})
  if (tick < MIN_TICK || tick > MAX_TICK) throw new Error('T');

  let abs   = tick < 0 ? -tick : tick;
  let ratio = JSBI.BigInt('0x100000000000000000000000000000000');   // 2^128

  for (let i = 0; i < 20; ++i) {
    if (abs & (1 << i)) {
      ratio = JSBI.divide(JSBI.multiply(ratio, MUL_CONSTANTS[i]), Q128);
    }
  }
  if (tick > 0) ratio = JSBI.divide(Q128, ratio);

  /* round-half-up then drop 32 bits (Q128 ➜ Q64.96) */
  const rounded = JSBI.add(ratio, JSBI.divide(Q128, JSBI.BigInt(2)));      // +2^127
  return JSBI.divide(rounded, JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(32)));
}

/* cache min/max sqrt */
const MIN_SQRT = JSBI.BigInt("4295128739");
const MAX_SQRT = JSBI.BigInt("1461446703485210103287273052203988822378723970342");

export function getTickAtSqrtRatio(sqrtAny) {
  const sqrt = toJSBI(sqrtAny);
  if (JSBI.lessThan(sqrt, MIN_SQRT) || JSBI.greaterThan(sqrt, MAX_SQRT)) {
    throw new Error('R');
  }

  let lo = MIN_TICK, hi = MAX_TICK;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (JSBI.lessThanOrEqual(getSqrtRatioAtTick(mid), sqrt)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}