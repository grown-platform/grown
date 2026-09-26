package sheets

import "math"

// formula_bessel.go — BESSELI, BESSELJ, BESSELK, BESSELY (OnlyOffice parity
// milestone M4).
//
// J uses Go's math.Jn (FreeBSD msun, BSD licence). I is summed from its
// power series. K uses the Abramowitz & Stegun 9.8.5–9.8.8 polynomial
// approximations for K0 and K1, and Y uses Hart's rational approximations
// for Y0 and Y1 (Computer Approximations, 1968) — the classic approximations
// whose results spreadsheet applications reproduce to the last printed
// digit. Higher orders of K and Y follow from the forward recurrences
// K(n+1) = K(n−1) + 2n/x·K(n) and Y(n+1) = 2n/x·Y(n) − Y(n−1).

func init() {
	registerFunc("BESSELI", func(c *callCtx) value {
		return besselFn(c, func(x float64, n int) value { return besselCheck(besselI(x, n)) })
	})
	registerFunc("BESSELJ", func(c *callCtx) value {
		return besselFn(c, func(x float64, n int) value { return besselCheck(math.Jn(n, x)) })
	})
	registerFunc("BESSELK", func(c *callCtx) value {
		return besselFn(c, func(x float64, n int) value {
			if x <= 0 {
				return errNum
			}
			return besselCheck(besselK(x, n))
		})
	})
	registerFunc("BESSELY", func(c *callCtx) value {
		return besselFn(c, func(x float64, n int) value {
			if x <= 0 {
				return errNum
			}
			return besselCheck(besselY(x, n))
		})
	})
}

// besselMaxOrder bounds the order n; beyond it every result has long since
// underflowed or overflowed, and the recurrences would only burn time.
const besselMaxOrder = 1 << 20

// besselArg reads one Bessel argument: both are required (an omitted
// argument is #N/A), booleans are rejected and a multi-cell range is #VALUE!.
func besselArg(c *callCtx, i int) (float64, value, bool) {
	if rv, ok := c.raw(i).(rangeVal); ok && rv.rows*rv.cols > 1 {
		return 0, errValue, false
	}
	v := c.scalar(i).topLeft()
	switch {
	case v.isErr():
		return 0, v, false
	case isOmitted(v):
		return 0, errNA, false
	case v.kind == kindBool:
		return 0, errValue, false
	}
	return mthNum(v)
}

func besselFn(c *callCtx, f func(x float64, n int) value) value {
	if c.nargs() != 2 {
		return errNA
	}
	x, e, ok := besselArg(c, 0)
	if !ok {
		return e
	}
	nf, e, ok := besselArg(c, 1)
	if !ok {
		return e
	}
	if nf < 0 {
		return errNum
	}
	nf = math.Trunc(nf)
	if nf > besselMaxOrder {
		return errNum
	}
	return f(x, int(nf))
}

func besselCheck(f float64) value {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return errNum
	}
	return numVal(f)
}

// besselI sums I_n(x) = Σ (x/2)^(2k+n) / (k!(n+k)!). The first term is
// formed in log space so large orders do not overflow the factorial.
func besselI(x float64, n int) float64 {
	if x == 0 {
		if n == 0 {
			return 1
		}
		return 0
	}
	h := x / 2
	lt := float64(n)*math.Log(math.Abs(h)) - lgammaF(float64(n)+1)
	term := math.Exp(lt)
	if h < 0 && n%2 == 1 {
		term = -term
	}
	sum := term
	q := h * h
	for k := 1; k < 10000; k++ {
		term *= q / (float64(k) * float64(k+n))
		sum += term
		if math.Abs(term) <= math.Abs(sum)*1e-17 {
			break
		}
	}
	return sum
}

func lgammaF(x float64) float64 {
	v, _ := math.Lgamma(x)
	return v
}

// besselK0 and besselK1 follow Abramowitz & Stegun 9.8.5–9.8.8.
func besselK0(x float64) float64 {
	if x <= 2 {
		t := x * x / 4
		return -math.Log(x/2)*besselI(x, 0) +
			(-0.57721566 + t*(0.42278420+t*(0.23069756+t*(0.03488590+t*(0.00262698+t*(0.00010750+t*0.00000740))))))
	}
	t := 2 / x
	return math.Exp(-x) / math.Sqrt(x) *
		(1.25331414 + t*(-0.07832358+t*(0.02189568+t*(-0.01062446+t*(0.00587872+t*(-0.00251540+t*0.00053208))))))
}

func besselK1(x float64) float64 {
	if x <= 2 {
		t := x * x / 4
		return math.Log(x/2)*besselI(x, 1) + (1/x)*
			(1+t*(0.15443144+t*(-0.67278579+t*(-0.18156897+t*(-0.01919402+t*(-0.00110404+t*(-0.00004686)))))))
	}
	t := 2 / x
	return math.Exp(-x) / math.Sqrt(x) *
		(1.25331414 + t*(0.23498619+t*(-0.03655620+t*(0.01504268+t*(-0.00780353+t*(0.00325614+t*(-0.00068245)))))))
}

func besselK(x float64, n int) float64 {
	k0 := besselK0(x)
	if n == 0 {
		return k0
	}
	k1 := besselK1(x)
	for i := 1; i < n; i++ {
		k0, k1 = k1, k0+2*float64(i)/x*k1
		if math.IsInf(k1, 0) {
			return k1
		}
	}
	return k1
}

// besselY0 and besselY1: rational approximations for x < 8 and the
// asymptotic P/Q expansions for x ≥ 8 (Hart, Computer Approximations).
func besselY0(x float64) float64 {
	if x < 8 {
		y := x * x
		num := -2957821389.0 + y*(7062834065.0+y*(-512359803.6+y*(10879881.29+y*(-86327.92757+y*228.4622733))))
		den := 40076544269.0 + y*(745249964.8+y*(7189466.438+y*(47447.26470+y*(226.1030244+y*1.0))))
		return num/den + 0.636619772*math.J0(x)*math.Log(x)
	}
	z := 8 / x
	y := z * z
	xx := x - 0.785398164
	p := 1 + y*(-0.1098628627e-2+y*(0.2734510407e-4+y*(-0.2073370639e-5+y*0.2093887211e-6)))
	q := -0.1562499995e-1 + y*(0.1430488765e-3+y*(-0.6911147651e-5+y*(0.7621095161e-6+y*(-0.934945152e-7))))
	return math.Sqrt(0.636619772/x) * (math.Sin(xx)*p + z*math.Cos(xx)*q)
}

func besselY1(x float64) float64 {
	if x < 8 {
		y := x * x
		num := x * (-0.4900604943e13 + y*(0.1275274390e13+y*(-0.5153438139e11+y*(0.7349264551e9+y*(-0.4237922726e7+y*0.8511937935e4)))))
		den := 0.2499580570e14 + y*(0.4244419664e12+y*(0.3733650367e10+y*(0.2245904002e8+y*(0.1020426050e6+y*(0.3549632885e3+y)))))
		return num/den + 0.636619772*(math.J1(x)*math.Log(x)-1/x)
	}
	z := 8 / x
	y := z * z
	xx := x - 2.356194491
	p := 1 + y*(0.183105e-2+y*(-0.3516396496e-4+y*(0.2457520174e-5+y*(-0.240337019e-6))))
	q := 0.04687499995 + y*(-0.2002690873e-3+y*(0.8449199096e-5+y*(-0.88228987e-6+y*0.105787412e-6)))
	return math.Sqrt(0.636619772/x) * (math.Sin(xx)*p + z*math.Cos(xx)*q)
}

func besselY(x float64, n int) float64 {
	y0 := besselY0(x)
	if n == 0 {
		return y0
	}
	y1 := besselY1(x)
	for i := 1; i < n; i++ {
		y0, y1 = y1, 2*float64(i)/x*y1-y0
		if math.IsInf(y1, 0) {
			return y1
		}
	}
	return y1
}
