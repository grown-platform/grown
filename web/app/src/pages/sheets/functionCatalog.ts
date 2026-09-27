// Function catalog for Insert ▸ Function: every function the Go engine
// (internal/sheets) evaluates, grouped by category, with its signature and a
// one-line description. Descriptions are Grown's own wording.
//
// Encoding: one line per function, "SIGNATURE|description". In a signature
// `[arg]` is optional and a trailing `...` marks an argument that repeats
// (number1, [number2]...). Argument help comes from ARG_HELP by name.

export type FunctionCategory =
  | "Financial"
  | "Date & time"
  | "Math & trig"
  | "Statistical"
  | "Lookup & reference"
  | "Database"
  | "Text"
  | "Logical"
  | "Information"
  | "Engineering"
  | "Dynamic arrays & lambda"
  | "Web"
  | "Compatibility"
  | "Other";

export interface FunctionArg {
  name: string;
  optional?: boolean;
  repeat?: boolean;
  help: string;
}

export interface FunctionInfo {
  name: string;
  category: FunctionCategory;
  signature: string;
  args: FunctionArg[];
  description: string;
}

const RAW: Record<FunctionCategory, string> = {
  Financial: `
ACCRINT(issue, first_interest, settlement, rate, par, frequency, [basis], [calc_method])|Interest accrued on a security that pays periodic interest.
ACCRINTM(issue, settlement, rate, [par], [basis])|Interest accrued on a security that pays interest at maturity.
AMORDEGRC(cost, date_purchased, first_period, salvage, period, rate, [basis])|French declining depreciation for a period, with a coefficient by asset life.
AMORLINC(cost, date_purchased, first_period, salvage, period, rate, [basis])|French linear depreciation for an accounting period.
COUPDAYBS(settlement, maturity, frequency, [basis])|Days from the start of the coupon period to settlement.
COUPDAYS(settlement, maturity, frequency, [basis])|Days in the coupon period that holds the settlement date.
COUPDAYSNC(settlement, maturity, frequency, [basis])|Days from settlement to the next coupon date.
COUPNCD(settlement, maturity, frequency, [basis])|The next coupon date after settlement.
COUPNUM(settlement, maturity, frequency, [basis])|Coupons payable between settlement and maturity.
COUPPCD(settlement, maturity, frequency, [basis])|The last coupon date on or before settlement.
CUMIPMT(rate, nper, pv, start_period, end_period, type)|Total interest paid on a loan between two periods.
CUMPRINC(rate, nper, pv, start_period, end_period, type)|Total principal repaid on a loan between two periods.
DB(cost, salvage, life, period, [month])|Fixed-declining-balance depreciation for a period.
DDB(cost, salvage, life, period, [factor])|Double-declining-balance (or other factor) depreciation for a period.
DISC(settlement, maturity, pr, redemption, [basis])|Discount rate of a security.
DOLLARDE(fractional_dollar, fraction)|Turns a price written as a fraction into a decimal number.
DOLLARFR(decimal_dollar, fraction)|Writes a decimal price as a fraction of the given denominator.
DURATION(settlement, maturity, coupon, yld, frequency, [basis])|Macaulay duration of a security with periodic interest.
EFFECT(nominal_rate, npery)|Effective annual rate from a nominal rate compounded npery times a year.
FV(rate, nper, pmt, [pv], [type])|Future value of an investment with constant payments and rate.
FVSCHEDULE(principal, schedule)|Future value of a principal after a series of compound rates.
INTRATE(settlement, maturity, investment, redemption, [basis])|Interest rate of a fully invested security.
IPMT(rate, per, nper, pv, [fv], [type])|Interest part of a loan payment for one period.
IRR(values, [guess])|Internal rate of return of a series of cash flows.
ISPMT(rate, per, nper, pv)|Interest paid in a period of a loan with even principal payments.
MDURATION(settlement, maturity, coupon, yld, frequency, [basis])|Modified duration of a security.
MIRR(values, finance_rate, reinvest_rate)|Internal rate of return with separate borrowing and reinvestment rates.
NOMINAL(effect_rate, npery)|Nominal annual rate from an effective rate.
NPER(rate, pmt, pv, [fv], [type])|Number of periods needed for an investment or loan.
NPV(rate, value1, [value2]...)|Net present value of future cash flows at a discount rate.
ODDFPRICE(settlement, maturity, issue, first_coupon, rate, yld, redemption, frequency, [basis])|Price of a security whose first period is odd.
ODDFYIELD(settlement, maturity, issue, first_coupon, rate, pr, redemption, frequency, [basis])|Yield of a security whose first period is odd.
ODDLPRICE(settlement, maturity, last_interest, rate, yld, redemption, frequency, [basis])|Price of a security whose last period is odd.
ODDLYIELD(settlement, maturity, last_interest, rate, pr, redemption, frequency, [basis])|Yield of a security whose last period is odd.
PDURATION(rate, pv, fv)|Periods needed for an investment to reach a value.
PMT(rate, nper, pv, [fv], [type])|Periodic payment for a loan with constant payments and rate.
PPMT(rate, per, nper, pv, [fv], [type])|Principal part of a loan payment for one period.
PRICE(settlement, maturity, rate, yld, redemption, frequency, [basis])|Price per 100 face value of a security paying periodic interest.
PRICEDISC(settlement, maturity, discount, redemption, [basis])|Price per 100 face value of a discounted security.
PRICEMAT(settlement, maturity, issue, rate, yld, [basis])|Price per 100 face value of a security paying interest at maturity.
PV(rate, nper, pmt, [fv], [type])|Present value of a series of future payments.
RATE(nper, pmt, pv, [fv], [type], [guess])|Interest rate per period of an annuity.
RECEIVED(settlement, maturity, investment, discount, [basis])|Amount received at maturity for a fully invested security.
RRI(nper, pv, fv)|Equivalent interest rate for the growth of an investment.
SLN(cost, salvage, life)|Straight-line depreciation for one period.
SYD(cost, salvage, life, per)|Sum-of-years'-digits depreciation for a period.
TBILLEQ(settlement, maturity, discount)|Bond-equivalent yield of a Treasury bill.
TBILLPRICE(settlement, maturity, discount)|Price per 100 face value of a Treasury bill.
TBILLYIELD(settlement, maturity, pr)|Yield of a Treasury bill.
VDB(cost, salvage, life, start_period, end_period, [factor], [no_switch])|Declining-balance depreciation over any span of periods.
XIRR(values, dates, [guess])|Internal rate of return for cash flows on irregular dates.
XNPV(rate, values, dates)|Net present value for cash flows on irregular dates.
YIELD(settlement, maturity, rate, pr, redemption, frequency, [basis])|Yield of a security paying periodic interest.
YIELDDISC(settlement, maturity, pr, redemption, [basis])|Annual yield of a discounted security.
YIELDMAT(settlement, maturity, issue, rate, pr, [basis])|Annual yield of a security paying interest at maturity.
`,
  "Date & time": `
DATE(year, month, day)|Builds a date from year, month and day numbers.
DATEDIF(start_date, end_date, unit)|Difference between two dates in days, months or years.
DATEVALUE(date_text)|Converts date text to a date serial number.
DAY(serial_number)|Day of the month (1-31) of a date.
DAYS(end_date, start_date)|Number of days between two dates.
DAYS360(start_date, end_date, [method])|Days between two dates on a 360-day year.
EDATE(start_date, months)|The date a number of months before or after a date.
EOMONTH(start_date, months)|Last day of the month a number of months away.
HOUR(serial_number)|Hour (0-23) of a time.
ISOWEEKNUM(date)|ISO week number of the year for a date.
MINUTE(serial_number)|Minute (0-59) of a time.
MONTH(serial_number)|Month (1-12) of a date.
NETWORKDAYS(start_date, end_date, [holidays])|Working days between two dates, Monday to Friday.
NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])|Working days between two dates with a custom weekend.
NOW()|The current date and time.
SECOND(serial_number)|Second (0-59) of a time.
TIME(hour, minute, second)|Builds a time from hours, minutes and seconds.
TIMEVALUE(time_text)|Converts time text to a fraction of a day.
TODAY()|The current date.
WEEKDAY(serial_number, [return_type])|Day of the week of a date as a number.
WEEKNUM(serial_number, [return_type])|Week number of the year for a date.
WORKDAY(start_date, days, [holidays])|The date a number of working days away.
WORKDAY.INTL(start_date, days, [weekend], [holidays])|The date a number of working days away, with a custom weekend.
YEAR(serial_number)|Year of a date.
YEARFRAC(start_date, end_date, [basis])|Fraction of a year between two dates.
`,
  "Math & trig": `
ABS(number)|Absolute value of a number.
ACOS(number)|Arccosine, in radians.
ACOSH(number)|Inverse hyperbolic cosine.
ACOT(number)|Arccotangent, in radians.
ACOTH(number)|Inverse hyperbolic cotangent.
AGGREGATE(function_num, options, ref1, [ref2]...)|An aggregate (sum, average, …) that can skip hidden rows and errors.
ARABIC(text)|Converts a Roman numeral to a number.
ASIN(number)|Arcsine, in radians.
ASINH(number)|Inverse hyperbolic sine.
ATAN(number)|Arctangent, in radians.
ATAN2(x_num, y_num)|Arctangent of the point (x, y), in radians.
ATANH(number)|Inverse hyperbolic tangent.
BASE(number, radix, [min_length])|Writes a number in another base.
CEILING.MATH(number, [significance], [mode])|Rounds up to a multiple of significance.
CEILING.PRECISE(number, [significance])|Rounds up to a multiple, whatever the sign.
COMBIN(number, number_chosen)|Number of combinations without repetition.
COMBINA(number, number_chosen)|Number of combinations with repetition.
COS(number)|Cosine of an angle in radians.
COSH(number)|Hyperbolic cosine.
COT(number)|Cotangent of an angle in radians.
COTH(number)|Hyperbolic cotangent.
CSC(number)|Cosecant of an angle in radians.
CSCH(number)|Hyperbolic cosecant.
DECIMAL(text, radix)|Reads a number written in another base.
DEGREES(angle)|Converts radians to degrees.
ECMA.CEILING(number, significance)|Rounds up to a multiple (ECMA variant).
EVEN(number)|Rounds away from zero to the next even integer.
EXP(number)|e raised to a power.
FACT(number)|Factorial of a number.
FACTDOUBLE(number)|Double factorial of a number.
FLOOR.MATH(number, [significance], [mode])|Rounds down to a multiple of significance.
FLOOR.PRECISE(number, [significance])|Rounds down to a multiple, whatever the sign.
GCD(number1, [number2]...)|Greatest common divisor.
INT(number)|Rounds down to the nearest integer.
ISO.CEILING(number, [significance])|Rounds up to a multiple (ISO variant).
LCM(number1, [number2]...)|Least common multiple.
LN(number)|Natural logarithm.
LOG(number, [base])|Logarithm in a base (10 by default).
LOG10(number)|Base-10 logarithm.
MDETERM(array)|Determinant of a square matrix.
MINVERSE(array)|Inverse of a square matrix.
MMULT(array1, array2)|Matrix product of two arrays.
MOD(number, divisor)|Remainder after division.
MROUND(number, multiple)|Rounds to the nearest multiple.
MULTINOMIAL(number1, [number2]...)|Multinomial coefficient of a set of numbers.
MUNIT(dimension)|Identity matrix of a size.
ODD(number)|Rounds away from zero to the next odd integer.
PI()|The number π.
POWER(number, power)|A number raised to a power.
PRODUCT(number1, [number2]...)|Multiplies its arguments.
QUOTIENT(numerator, denominator)|Integer part of a division.
RADIANS(angle)|Converts degrees to radians.
RAND()|A random number from 0 up to 1.
RANDARRAY([rows], [columns], [min], [max], [whole_number])|An array of random numbers.
RANDBETWEEN(bottom, top)|A random integer between two values.
ROMAN(number, [form])|Writes a number as a Roman numeral.
ROUND(number, num_digits)|Rounds to a number of digits.
ROUNDDOWN(number, num_digits)|Rounds toward zero.
ROUNDUP(number, num_digits)|Rounds away from zero.
SEC(number)|Secant of an angle in radians.
SECH(number)|Hyperbolic secant.
SERIESSUM(x, n, m, coefficients)|Sum of a power series.
SIGN(number)|1, 0 or -1 by the sign of a number.
SIN(number)|Sine of an angle in radians.
SINH(number)|Hyperbolic sine.
SQRT(number)|Square root.
SQRTPI(number)|Square root of a number times π.
SUBTOTAL(function_num, ref1, [ref2]...)|A subtotal (sum, average, …) that ignores other subtotals.
SUM(number1, [number2]...)|Adds numbers and ranges.
SUMIF(range, criteria, [sum_range])|Adds the cells that meet a condition.
SUMIFS(sum_range, criteria_range1, criteria1, [criteria_range2, criteria2]...)|Adds the cells that meet several conditions.
SUMPRODUCT(array1, [array2]...)|Sum of the products of matching items.
SUMSQ(number1, [number2]...)|Sum of squares.
SUMX2MY2(array_x, array_y)|Sum of the differences of squares of matching items.
SUMX2PY2(array_x, array_y)|Sum of the sums of squares of matching items.
SUMXMY2(array_x, array_y)|Sum of squared differences of matching items.
TAN(number)|Tangent of an angle in radians.
TANH(number)|Hyperbolic tangent.
TRUNC(number, [num_digits])|Cuts a number to a number of digits.
`,
  Statistical: `
AVEDEV(number1, [number2]...)|Average absolute deviation from the mean.
AVERAGE(number1, [number2]...)|Arithmetic mean.
AVERAGEA(value1, [value2]...)|Mean counting text as 0 and TRUE as 1.
AVERAGEIF(range, criteria, [average_range])|Mean of the cells that meet a condition.
AVERAGEIFS(average_range, criteria_range1, criteria1, [criteria_range2, criteria2]...)|Mean of the cells that meet several conditions.
BETA.DIST(x, alpha, beta, cumulative, [A], [B])|Beta distribution.
BETA.INV(probability, alpha, beta, [A], [B])|Inverse of the beta distribution.
BINOM.DIST(number_s, trials, probability_s, cumulative)|Binomial distribution.
BINOM.DIST.RANGE(trials, probability_s, number_s, [number_s2])|Probability of a number of successes in a range.
BINOM.INV(trials, probability_s, alpha)|Smallest successes whose binomial CDF reaches alpha.
CHISQ.DIST(x, deg_freedom, cumulative)|Chi-squared distribution.
CHISQ.DIST.RT(x, deg_freedom)|Right tail of the chi-squared distribution.
CHISQ.INV(probability, deg_freedom)|Inverse of the chi-squared distribution.
CHISQ.INV.RT(probability, deg_freedom)|Inverse of the chi-squared right tail.
CHISQ.TEST(actual_range, expected_range)|Chi-squared test of independence.
CONFIDENCE.NORM(alpha, standard_dev, size)|Confidence interval half-width, normal distribution.
CONFIDENCE.T(alpha, standard_dev, size)|Confidence interval half-width, Student's t.
CORREL(array1, array2)|Correlation coefficient of two data sets.
COUNT(value1, [value2]...)|Counts the numbers.
COUNTA(value1, [value2]...)|Counts the non-empty values.
COUNTBLANK(range)|Counts the empty cells.
COUNTIF(range, criteria)|Counts the cells that meet a condition.
COUNTIFS(criteria_range1, criteria1, [criteria_range2, criteria2]...)|Counts the cells that meet several conditions.
COUNTUNIQUE(value1, [value2]...)|Counts the distinct values.
COVARIANCE.P(array1, array2)|Population covariance.
COVARIANCE.S(array1, array2)|Sample covariance.
DEVSQ(number1, [number2]...)|Sum of squared deviations from the mean.
EXPON.DIST(x, lambda, cumulative)|Exponential distribution.
F.DIST(x, deg_freedom1, deg_freedom2, cumulative)|F distribution.
F.DIST.RT(x, deg_freedom1, deg_freedom2)|Right tail of the F distribution.
F.INV(probability, deg_freedom1, deg_freedom2)|Inverse of the F distribution.
F.INV.RT(probability, deg_freedom1, deg_freedom2)|Inverse of the F right tail.
F.TEST(array1, array2)|F-test of two variances.
FISHER(x)|Fisher transformation.
FISHERINV(y)|Inverse Fisher transformation.
FORECAST(x, known_ys, known_xs)|Predicts a value on a linear trend.
FORECAST.LINEAR(x, known_ys, known_xs)|Predicts a value on a linear trend.
FREQUENCY(data_array, bins_array)|How many values fall in each bin.
GAMMA(x)|Gamma function.
GAMMA.DIST(x, alpha, beta, cumulative)|Gamma distribution.
GAMMA.INV(probability, alpha, beta)|Inverse of the gamma distribution.
GAMMALN(x)|Natural log of the gamma function.
GAMMALN.PRECISE(x)|Natural log of the gamma function.
GAUSS(z)|Probability between the mean and z standard deviations.
GEOMEAN(number1, [number2]...)|Geometric mean.
GROWTH(known_ys, [known_xs], [new_xs], [const])|Values on a fitted exponential trend.
HARMEAN(number1, [number2]...)|Harmonic mean.
HYPGEOM.DIST(sample_s, number_sample, population_s, number_pop, cumulative)|Hypergeometric distribution.
INTERCEPT(known_ys, known_xs)|Where the regression line crosses the y axis.
KURT(number1, [number2]...)|Kurtosis of a data set.
LARGE(array, k)|The k-th largest value.
LINEST(known_ys, [known_xs], [const], [stats])|Statistics of a least-squares line.
LOGEST(known_ys, [known_xs], [const], [stats])|Statistics of a fitted exponential curve.
LOGNORM.DIST(x, mean, standard_dev, cumulative)|Lognormal distribution.
LOGNORM.INV(probability, mean, standard_dev)|Inverse of the lognormal distribution.
MAX(number1, [number2]...)|Largest number.
MAXA(value1, [value2]...)|Largest value, counting text as 0 and TRUE as 1.
MAXIFS(max_range, criteria_range1, criteria1, [criteria_range2, criteria2]...)|Largest value among cells that meet conditions.
MEDIAN(number1, [number2]...)|Middle value.
MIN(number1, [number2]...)|Smallest number.
MINA(value1, [value2]...)|Smallest value, counting text as 0 and TRUE as 1.
MINIFS(min_range, criteria_range1, criteria1, [criteria_range2, criteria2]...)|Smallest value among cells that meet conditions.
MODE.MULT(number1, [number2]...)|The most frequent values, as a vertical array.
MODE.SNGL(number1, [number2]...)|The most frequent value.
NEGBINOM.DIST(number_f, number_s, probability_s, cumulative)|Negative binomial distribution.
NORM.DIST(x, mean, standard_dev, cumulative)|Normal distribution.
NORM.INV(probability, mean, standard_dev)|Inverse of the normal distribution.
NORM.S.DIST(z, cumulative)|Standard normal distribution.
NORM.S.INV(probability)|Inverse of the standard normal distribution.
PEARSON(array1, array2)|Pearson correlation coefficient.
PERCENTILE.EXC(array, k)|k-th percentile, k strictly between 0 and 1.
PERCENTILE.INC(array, k)|k-th percentile, k from 0 to 1.
PERCENTRANK.EXC(array, x, [significance])|Rank of a value as a percentage (exclusive).
PERCENTRANK.INC(array, x, [significance])|Rank of a value as a percentage (inclusive).
PERMUT(number, number_chosen)|Number of permutations.
PERMUTATIONA(number, number_chosen)|Number of permutations with repetition.
PHI(x)|Density of the standard normal distribution.
POISSON.DIST(x, mean, cumulative)|Poisson distribution.
PROB(x_range, prob_range, lower_limit, [upper_limit])|Probability that values fall between limits.
QUARTILE.EXC(array, quart)|Quartile (exclusive method).
QUARTILE.INC(array, quart)|Quartile (inclusive method).
RANK.AVG(number, ref, [order])|Rank of a number, ties get the average rank.
RANK.EQ(number, ref, [order])|Rank of a number, ties get the top rank.
RSQ(known_ys, known_xs)|Square of the Pearson correlation.
SKEW(number1, [number2]...)|Skewness of a sample.
SKEW.P(number1, [number2]...)|Skewness of a population.
SLOPE(known_ys, known_xs)|Slope of the regression line.
SMALL(array, k)|The k-th smallest value.
STANDARDIZE(x, mean, standard_dev)|z-score of a value.
STDEV.P(number1, [number2]...)|Standard deviation of a population.
STDEV.S(number1, [number2]...)|Standard deviation of a sample.
STDEVA(value1, [value2]...)|Sample standard deviation counting text and logicals.
STDEVPA(value1, [value2]...)|Population standard deviation counting text and logicals.
STEYX(known_ys, known_xs)|Standard error of the regression's predicted y.
T.DIST(x, deg_freedom, cumulative)|Student's t distribution (left tail).
T.DIST.2T(x, deg_freedom)|Two-tailed Student's t distribution.
T.DIST.RT(x, deg_freedom)|Right-tailed Student's t distribution.
T.INV(probability, deg_freedom)|Left-tailed inverse of Student's t.
T.INV.2T(probability, deg_freedom)|Two-tailed inverse of Student's t.
T.TEST(array1, array2, tails, type)|Probability from a Student's t-test.
TREND(known_ys, [known_xs], [new_xs], [const])|Values on a fitted linear trend.
TRIMMEAN(array, percent)|Mean without a share of the extreme values.
VAR.P(number1, [number2]...)|Variance of a population.
VAR.S(number1, [number2]...)|Variance of a sample.
VARA(value1, [value2]...)|Sample variance counting text and logicals.
VARPA(value1, [value2]...)|Population variance counting text and logicals.
WEIBULL.DIST(x, alpha, beta, cumulative)|Weibull distribution.
Z.TEST(array, x, [sigma])|One-tailed probability of a z-test.
`,
  "Lookup & reference": `
ADDRESS(row_num, column_num, [abs_num], [a1], [sheet_text])|Builds a cell address as text.
AREAS(reference)|Number of areas in a reference.
CHOOSE(index_num, value1, [value2]...)|Picks a value from a list by position.
CHOOSECOLS(array, col_num1, [col_num2]...)|The given columns of an array.
CHOOSEROWS(array, row_num1, [row_num2]...)|The given rows of an array.
COLUMN([reference])|Column number of a reference.
COLUMNS(array)|Number of columns in a range or array.
FORMULATEXT(reference)|The formula in a cell, as text.
GETPIVOTDATA(data_field, pivot_table, [field1, item1]...)|A value from a pivot table report.
HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])|Looks across the top row and returns a value from a row below.
HYPERLINK(link_location, [friendly_name])|A clickable link.
INDEX(array, row_num, [column_num], [area_num])|The value at a row and column of a range.
INDIRECT(ref_text, [a1])|The reference named by a text.
LOOKUP(lookup_value, lookup_vector, [result_vector])|Looks up a value in a row or column.
MATCH(lookup_value, lookup_array, [match_type])|Position of a value in a range.
OFFSET(reference, rows, cols, [height], [width])|A reference shifted from a starting cell.
ROW([reference])|Row number of a reference.
ROWS(array)|Number of rows in a range or array.
TRANSPOSE(array)|Swaps the rows and columns of an array.
VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])|Looks down the first column and returns a value from a column to the right.
XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])|Finds a value and returns the matching item from another range.
XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])|Position of a value, with match and search modes.
`,
  Database: `
DAVERAGE(database, field, criteria)|Mean of a field over the records that match.
DCOUNT(database, field, criteria)|Counts numbers in a field over the records that match.
DCOUNTA(database, field, criteria)|Counts non-empty values in a field over the records that match.
DGET(database, field, criteria)|The single value of a field in the one matching record.
DMAX(database, field, criteria)|Largest value of a field over the records that match.
DMIN(database, field, criteria)|Smallest value of a field over the records that match.
DPRODUCT(database, field, criteria)|Product of a field over the records that match.
DSTDEV(database, field, criteria)|Sample standard deviation of a field over matching records.
DSTDEVP(database, field, criteria)|Population standard deviation of a field over matching records.
DSUM(database, field, criteria)|Sum of a field over the records that match.
DVAR(database, field, criteria)|Sample variance of a field over matching records.
DVARP(database, field, criteria)|Population variance of a field over matching records.
`,
  Text: `
ARRAYTOTEXT(array, [format])|An array written as text.
ASC(text)|Turns full-width characters into half-width ones.
CHAR(number)|The character with a code.
CLEAN(text)|Removes non-printing characters.
CODE(text)|Code of the first character.
CONCAT(text1, [text2]...)|Joins texts and ranges.
CONCATENATE(text1, [text2]...)|Joins texts.
DOLLAR(number, [decimals])|A number as currency text.
EXACT(text1, text2)|TRUE when two texts are identical, case included.
FIND(find_text, within_text, [start_num])|Position of a text inside another (case-sensitive).
FINDB(find_text, within_text, [start_num])|FIND counting double-byte characters as two.
FIXED(number, [decimals], [no_commas])|A number as text with fixed decimals.
JOIN(delimiter, value1, [value2]...)|Joins values with a delimiter.
LEFT(text, [num_chars])|Characters from the start of a text.
LEFTB(text, [num_bytes])|Bytes from the start of a text.
LEN(text)|Number of characters.
LENB(text)|Number of bytes.
LOWER(text)|Converts to lower case.
MID(text, start_num, num_chars)|Characters from the middle of a text.
MIDB(text, start_num, num_bytes)|Bytes from the middle of a text.
NUMBERVALUE(text, [decimal_separator], [group_separator])|Reads a number from text with given separators.
PROPER(text)|Capitalizes each word.
REGEXEXTRACT(text, regular_expression)|The part of a text that matches a pattern.
REGEXMATCH(text, regular_expression)|TRUE when a text matches a pattern.
REGEXREPLACE(text, regular_expression, replacement)|Replaces the parts of a text that match a pattern.
REGEXTEST(text, pattern, [case_sensitivity])|TRUE when a text matches a pattern.
REPLACE(old_text, start_num, num_chars, new_text)|Replaces characters at a position.
REPLACEB(old_text, start_num, num_bytes, new_text)|Replaces bytes at a position.
REPT(text, number_times)|Repeats a text.
RIGHT(text, [num_chars])|Characters from the end of a text.
RIGHTB(text, [num_bytes])|Bytes from the end of a text.
SEARCH(find_text, within_text, [start_num])|Position of a text inside another (ignores case, wildcards).
SEARCHB(find_text, within_text, [start_num])|SEARCH counting double-byte characters as two.
SPLIT(text, delimiter, [split_by_each], [remove_empty_text])|Splits a text into cells.
SUBSTITUTE(text, old_text, new_text, [instance_num])|Replaces occurrences of a text.
T(value)|The value if it is text, otherwise empty.
TEXT(value, format_text)|A number formatted as text.
TEXTAFTER(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found])|Text after a delimiter.
TEXTBEFORE(text, delimiter, [instance_num], [match_mode], [match_end], [if_not_found])|Text before a delimiter.
TEXTJOIN(delimiter, ignore_empty, text1, [text2]...)|Joins texts with a delimiter, optionally skipping blanks.
TEXTSPLIT(text, col_delimiter, [row_delimiter], [ignore_empty], [match_mode], [pad_with])|Splits a text into rows and columns.
TRIM(text)|Removes extra spaces.
UNICHAR(number)|The Unicode character with a code point.
UNICODE(text)|Code point of the first character.
UPPER(text)|Converts to upper case.
VALUE(text)|Converts text to a number.
VALUETOTEXT(value, [format])|A value written as text.
`,
  Logical: `
AND(logical1, [logical2]...)|TRUE when every argument is true.
FALSE()|The logical value FALSE.
IF(logical_test, [value_if_true], [value_if_false])|One value when a test is true, another when it is false.
IFERROR(value, value_if_error)|A fallback when a value is an error.
IFNA(value, value_if_na)|A fallback when a value is #N/A.
IFS(logical_test1, value_if_true1, [logical_test2, value_if_true2]...)|The value for the first true test.
NOT(logical)|Reverses a logical value.
OR(logical1, [logical2]...)|TRUE when any argument is true.
SWITCH(expression, value1, result1, [default_or_value2, result2]...)|Matches an expression against values and returns the result.
TRUE()|The logical value TRUE.
XOR(logical1, [logical2]...)|TRUE when an odd number of arguments are true.
`,
  Information: `
CELL(info_type, [reference])|Information about a cell's format, place or content.
ERROR.TYPE(error_val)|A number for each error value.
ISBETWEEN(value, lower_value, upper_value, [lower_inclusive], [upper_inclusive])|TRUE when a value lies between two others.
ISBLANK(value)|TRUE when a cell is empty.
ISEMAIL(value)|TRUE when a text looks like an email address.
ISERR(value)|TRUE for any error except #N/A.
ISERROR(value)|TRUE for any error.
ISEVEN(number)|TRUE when a number is even.
ISFORMULA(reference)|TRUE when a cell holds a formula.
ISLOGICAL(value)|TRUE for a logical value.
ISNA(value)|TRUE for #N/A.
ISNONTEXT(value)|TRUE for anything that is not text.
ISNUMBER(value)|TRUE for a number.
ISODD(number)|TRUE when a number is odd.
ISREF(value)|TRUE for a reference.
ISTEXT(value)|TRUE for text.
ISURL(value)|TRUE when a text looks like a URL.
N(value)|A value converted to a number.
NA()|The #N/A error.
SHEET([value])|Sheet number of a reference or sheet name.
SHEETS([reference])|Number of sheets in a reference or the workbook.
TYPE(value)|A number for the type of a value.
`,
  Engineering: `
BESSELI(x, n)|Modified Bessel function In(x).
BESSELJ(x, n)|Bessel function Jn(x).
BESSELK(x, n)|Modified Bessel function Kn(x).
BESSELY(x, n)|Bessel function Yn(x).
BIN2DEC(number)|Binary to decimal.
BIN2HEX(number, [places])|Binary to hexadecimal.
BIN2OCT(number, [places])|Binary to octal.
BITAND(number1, number2)|Bitwise AND.
BITLSHIFT(number, shift_amount)|Shifts bits to the left.
BITOR(number1, number2)|Bitwise OR.
BITRSHIFT(number, shift_amount)|Shifts bits to the right.
BITXOR(number1, number2)|Bitwise exclusive OR.
COMPLEX(real_num, i_num, [suffix])|Builds a complex number.
CONVERT(number, from_unit, to_unit)|Converts between units of measure.
DEC2BIN(number, [places])|Decimal to binary.
DEC2HEX(number, [places])|Decimal to hexadecimal.
DEC2OCT(number, [places])|Decimal to octal.
DELTA(number1, [number2])|1 when two numbers are equal, else 0.
ERF(lower_limit, [upper_limit])|Error function.
ERF.PRECISE(x)|Error function from 0 to x.
ERFC(x)|Complementary error function.
ERFC.PRECISE(x)|Complementary error function.
GESTEP(number, [step])|1 when a number is at least a step, else 0.
HEX2BIN(number, [places])|Hexadecimal to binary.
HEX2DEC(number)|Hexadecimal to decimal.
HEX2OCT(number, [places])|Hexadecimal to octal.
IMABS(inumber)|Modulus of a complex number.
IMAGINARY(inumber)|Imaginary part of a complex number.
IMARGUMENT(inumber)|Argument (angle) of a complex number.
IMCONJUGATE(inumber)|Complex conjugate.
IMCOS(inumber)|Cosine of a complex number.
IMCOSH(inumber)|Hyperbolic cosine of a complex number.
IMCOT(inumber)|Cotangent of a complex number.
IMCSC(inumber)|Cosecant of a complex number.
IMCSCH(inumber)|Hyperbolic cosecant of a complex number.
IMDIV(inumber1, inumber2)|Quotient of two complex numbers.
IMEXP(inumber)|Exponential of a complex number.
IMLN(inumber)|Natural log of a complex number.
IMLOG10(inumber)|Base-10 log of a complex number.
IMLOG2(inumber)|Base-2 log of a complex number.
IMPOWER(inumber, number)|A complex number raised to a power.
IMPRODUCT(inumber1, [inumber2]...)|Product of complex numbers.
IMREAL(inumber)|Real part of a complex number.
IMSEC(inumber)|Secant of a complex number.
IMSECH(inumber)|Hyperbolic secant of a complex number.
IMSIN(inumber)|Sine of a complex number.
IMSINH(inumber)|Hyperbolic sine of a complex number.
IMSQRT(inumber)|Square root of a complex number.
IMSUB(inumber1, inumber2)|Difference of two complex numbers.
IMSUM(inumber1, [inumber2]...)|Sum of complex numbers.
IMTAN(inumber)|Tangent of a complex number.
OCT2BIN(number, [places])|Octal to binary.
OCT2DEC(number)|Octal to decimal.
OCT2HEX(number, [places])|Octal to hexadecimal.
`,
  "Dynamic arrays & lambda": `
ARRAYFORMULA(array_formula)|Evaluates a formula over ranges, returning an array.
BYCOL(array, lambda)|Applies a LAMBDA to each column.
BYROW(array, lambda)|Applies a LAMBDA to each row.
DROP(array, rows, [columns])|An array without its first or last rows or columns.
EXPAND(array, rows, [columns], [pad_with])|Grows an array to a size.
FILTER(array, include, [if_empty])|The rows or columns that meet a condition.
FLATTEN(range1, [range2]...)|All values in one column.
GROUPBY(row_fields, values, function, [field_headers], [total_depth], [sort_order], [filter_array])|Groups rows and aggregates values.
HSTACK(array1, [array2]...)|Places arrays side by side.
LAMBDA([parameter1]..., calculation)|A reusable function with parameters.
LET(name1, name_value1, [name2, name_value2]..., calculation)|Names values for use in a calculation.
MAKEARRAY(rows, cols, lambda)|An array computed by a LAMBDA for each position.
MAP(array1, [array2]..., lambda)|Applies a LAMBDA to each item.
PIVOTBY(row_fields, col_fields, values, function, [field_headers], [row_total_depth], [row_sort_order], [col_total_depth], [col_sort_order], [filter_array])|Groups by rows and columns and aggregates values.
QUERY(data, query, [headers])|Runs a SQL-like query over a range.
REDUCE(initial_value, array, lambda)|Folds an array into one value with a LAMBDA.
SCAN(initial_value, array, lambda)|Every intermediate value of a REDUCE.
SEQUENCE(rows, [columns], [start], [step])|An array of sequential numbers.
SINGLE(value)|Implicit intersection: one value from a range.
SORT(array, [sort_index], [sort_order], [by_col])|Sorts an array.
SORTBY(array, by_array1, [sort_order1], [by_array2, sort_order2]...)|Sorts an array by other arrays.
SORTN(range, [n], [display_ties_mode], [sort_column], [is_ascending])|The first n rows after sorting.
TAKE(array, rows, [columns])|The first or last rows or columns of an array.
TOCOL(array, [ignore], [scan_by_column])|An array as one column.
TOROW(array, [ignore], [scan_by_column])|An array as one row.
UNIQUE(array, [by_col], [exactly_once])|The distinct rows or columns.
VSTACK(array1, [array2]...)|Stacks arrays vertically.
WRAPCOLS(vector, wrap_count, [pad_with])|Wraps a row or column into columns.
WRAPROWS(vector, wrap_count, [pad_with])|Wraps a row or column into rows.
`,
  Web: `
ENCODEURL(text)|Encodes a text for use in a URL.
`,
  Compatibility: `
BETADIST(x, alpha, beta, [A], [B])|Cumulative beta distribution (older name).
BETAINV(probability, alpha, beta, [A], [B])|Inverse beta distribution (older name).
BINOMDIST(number_s, trials, probability_s, cumulative)|Binomial distribution (older name).
CEILING(number, significance)|Rounds up to a multiple of significance.
CHIDIST(x, deg_freedom)|Right tail of the chi-squared distribution (older name).
CHIINV(probability, deg_freedom)|Inverse chi-squared right tail (older name).
CHITEST(actual_range, expected_range)|Chi-squared test (older name).
CONFIDENCE(alpha, standard_dev, size)|Confidence interval half-width (older name).
COVAR(array1, array2)|Population covariance (older name).
CRITBINOM(trials, probability_s, alpha)|Smallest successes whose binomial CDF reaches alpha (older name).
EXPONDIST(x, lambda, cumulative)|Exponential distribution (older name).
FDIST(x, deg_freedom1, deg_freedom2)|Right tail of the F distribution (older name).
FINV(probability, deg_freedom1, deg_freedom2)|Inverse F right tail (older name).
FLOOR(number, significance)|Rounds down to a multiple of significance.
FTEST(array1, array2)|F-test (older name).
GAMMADIST(x, alpha, beta, cumulative)|Gamma distribution (older name).
GAMMAINV(probability, alpha, beta)|Inverse gamma distribution (older name).
HYPGEOMDIST(sample_s, number_sample, population_s, number_pop)|Hypergeometric distribution (older name).
LOGINV(probability, mean, standard_dev)|Inverse lognormal distribution (older name).
LOGNORMDIST(x, mean, standard_dev)|Cumulative lognormal distribution (older name).
MODE(number1, [number2]...)|Most frequent value (older name).
NEGBINOMDIST(number_f, number_s, probability_s)|Negative binomial distribution (older name).
NORMDIST(x, mean, standard_dev, cumulative)|Normal distribution (older name).
NORMINV(probability, mean, standard_dev)|Inverse normal distribution (older name).
NORMSDIST(z)|Cumulative standard normal distribution (older name).
NORMSINV(probability)|Inverse standard normal distribution (older name).
PERCENTILE(array, k)|k-th percentile (older name).
PERCENTRANK(array, x, [significance])|Rank as a percentage (older name).
POISSON(x, mean, cumulative)|Poisson distribution (older name).
QUARTILE(array, quart)|Quartile (older name).
RANK(number, ref, [order])|Rank of a number (older name).
STDEV(number1, [number2]...)|Sample standard deviation (older name).
STDEVP(number1, [number2]...)|Population standard deviation (older name).
TDIST(x, deg_freedom, tails)|Student's t distribution tail (older name).
TINV(probability, deg_freedom)|Two-tailed inverse of Student's t (older name).
TTEST(array1, array2, tails, type)|Student's t-test (older name).
VAR(number1, [number2]...)|Sample variance (older name).
VARP(number1, [number2]...)|Population variance (older name).
WEIBULL(x, alpha, beta, cumulative)|Weibull distribution (older name).
ZTEST(array, x, [sigma])|z-test (older name).
`,
  Other: `
SPARKLINE(data, [options])|A small in-cell chart of a data range.
`,
};

/** The functions offered first under "Most used". */
export const MOST_USED = [
  "SUM", "AVERAGE", "COUNT", "MAX", "MIN", "IF", "SUMIF", "COUNTIF", "VLOOKUP", "XLOOKUP",
  "INDEX", "MATCH", "IFERROR", "ROUND", "CONCAT", "TODAY",
];

// Help text by argument name (the digits of numbered arguments are ignored).
const ARG_HELP: Record<string, string> = {
  number: "A number, a cell reference or a range of numbers.",
  value: "A value, a cell reference or a range.",
  logical: "A condition or value that is TRUE or FALSE.",
  logical_test: "A condition that is TRUE or FALSE.",
  value_if_true: "The result when the condition is TRUE.",
  value_if_false: "The result when the condition is FALSE.",
  text: "A text in quotes or a cell holding text.",
  range: "The cells to check.",
  criteria: 'The condition, such as 5, ">3" or "apple*".',
  criteria_range: "The cells to check against the matching condition.",
  sum_range: "The cells to add (defaults to the checked range).",
  average_range: "The cells to average (defaults to the checked range).",
  array: "A range or an array.",
  reference: "A cell or range reference.",
  rate: "The interest rate per period.",
  nper: "The total number of payment periods.",
  per: "The period to look at (1 to nper).",
  pmt: "The payment made each period.",
  pv: "The present value (the amount now).",
  fv: "The future value wanted after the last payment (0 if omitted).",
  type: "When payments are due: 0 at the end of a period, 1 at the start.",
  guess: "A starting estimate for the answer.",
  settlement: "The settlement date of the security.",
  maturity: "The maturity date of the security.",
  issue: "The issue date of the security.",
  basis: "Day count basis: 0 US 30/360, 1 actual/actual, 2 actual/360, 3 actual/365, 4 European 30/360.",
  frequency: "Coupon payments per year: 1, 2 or 4.",
  redemption: "The redemption value per 100 face value.",
  pr: "The price per 100 face value.",
  yld: "The annual yield.",
  cost: "The initial cost of the asset.",
  salvage: "The value at the end of the asset's life.",
  life: "The number of periods over which the asset depreciates.",
  period: "The period to compute.",
  start_date: "A date (a serial number, a date cell or DATE(...)).",
  end_date: "A date (a serial number, a date cell or DATE(...)).",
  serial_number: "A date or time (a serial number or a date cell).",
  date: "A date (a serial number or a date cell).",
  holidays: "Optional dates to skip.",
  weekend: "Which days are the weekend (a number or a 7-character mask like 0000011).",
  months: "Months before (negative) or after (positive) the date.",
  lookup_value: "The value to look for.",
  table_array: "The table to search; the first column (or row) is searched.",
  lookup_array: "The range to search.",
  return_array: "The range to return values from.",
  col_index_num: "Which column of the table to return (1 = first).",
  row_index_num: "Which row of the table to return (1 = first).",
  range_lookup: "FALSE for an exact match; TRUE (default) for the closest match in sorted data.",
  match_type: "1 largest value ≤ (sorted), 0 exact, -1 smallest value ≥ (sorted desc).",
  match_mode: "0 exact, -1 exact or next smaller, 1 exact or next larger, 2 wildcard.",
  search_mode: "1 first to last, -1 last to first, 2/-2 binary search.",
  if_not_found: "What to return when nothing matches.",
  row_num: "The row number.",
  column_num: "The column number.",
  database: "The list of records, with a header row.",
  field: "The column: its header text or its position.",
  delimiter: "The separator text.",
  lambda: "A LAMBDA to apply.",
  rows: "Number of rows.",
  columns: "Number of columns.",
  k: "The position or fraction to return.",
  significance: "The multiple to round to.",
  num_digits: "Number of digits to round to (negative rounds left of the decimal point).",
  known_ys: "The observed y values.",
  known_xs: "The observed x values.",
  x: "The value to evaluate at.",
  mean: "The mean of the distribution.",
  standard_dev: "The standard deviation.",
  cumulative: "TRUE for the cumulative distribution, FALSE for the density.",
  probability: "A probability between 0 and 1.",
  deg_freedom: "Degrees of freedom.",
  alpha: "A shape parameter or significance level.",
  beta: "A shape or scale parameter.",
  inumber: 'A complex number, such as "3+4i".',
  places: "Number of characters to pad the result to.",
  format_text: 'A number format code, such as "0.00" or "yyyy-mm-dd".',
  num_chars: "How many characters.",
  start_num: "Where to start (1 = first character).",
  find_text: "The text to find.",
  within_text: "The text to search in.",
  sort_order: "1 ascending, -1 descending.",
  include: "TRUE/FALSE per row (or column) to keep.",
  if_empty: "What to return when nothing is kept.",
  pad_with: "The value for new cells (#N/A if omitted).",
  calculation: "The formula to compute, using the names.",
  function_num: "Which aggregate: 1 AVERAGE, 2 COUNT, 9 SUM, … (add 100 to skip hidden rows).",
  ref: "A range reference.",
  values: "The cash flows or values.",
  dates: "The dates of the cash flows.",
};

function argHelp(name: string): string {
  const key = name.toLowerCase().replace(/\d+$/, "");
  return ARG_HELP[name.toLowerCase()] ?? ARG_HELP[key] ?? `The ${name.replace(/_/g, " ")} argument.`;
}

/** parseSignature turns "NAME(a, [b], c...)" into its name and arguments. */
export function parseSignature(sig: string): { name: string; args: FunctionArg[] } {
  const m = /^([A-Z0-9.]+)\((.*)\)$/.exec(sig.trim());
  if (!m) throw new Error(`bad signature: ${sig}`);
  const inner = m[2].trim();
  const args: FunctionArg[] = [];
  if (inner) {
    // A bracket may span several arguments ("[criteria_range2, criteria2]...");
    // every member of such a group is optional and repeats with it.
    let group: FunctionArg[] | null = null;
    for (const raw of inner.split(",")) {
      let t = raw.trim();
      const repeat = t.endsWith("...");
      if (repeat) t = t.slice(0, -3).trim();
      const opens = t.startsWith("[");
      const closes = t.endsWith("]");
      t = t.replace(/^\[|\]$/g, "").trim();
      if (!t || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) throw new Error(`bad argument "${raw}" in ${sig}`);
      const a: FunctionArg = { name: t, help: argHelp(t) };
      if (opens || group) a.optional = true;
      if (opens && !closes) group = [];
      if (group) group.push(a);
      if (repeat) {
        for (const g of group ?? [a]) g.repeat = true;
      }
      if (closes) group = null;
      args.push(a);
    }
    if (group) throw new Error(`unclosed bracket in ${sig}`);
  }
  return { name: m[1], args };
}

let cache: FunctionInfo[] | null = null;

/** The whole catalog, sorted by name. */
export function functionCatalog(): FunctionInfo[] {
  if (cache) return cache;
  const out: FunctionInfo[] = [];
  for (const [category, block] of Object.entries(RAW) as [FunctionCategory, string][]) {
    for (const line of block.split("\n")) {
      if (!line.trim()) continue;
      const bar = line.indexOf("|");
      const signature = line.slice(0, bar).trim();
      const { name, args } = parseSignature(signature);
      out.push({ name, category, signature, args, description: line.slice(bar + 1).trim() });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  cache = out;
  return out;
}

export const FUNCTION_CATEGORIES = Object.keys(RAW) as FunctionCategory[];

export function findFunction(name: string): FunctionInfo | undefined {
  const up = name.toUpperCase();
  return functionCatalog().find((f) => f.name === up);
}

/** searchFunctions filters by category ("All", "Most used" or a category) and query. */
export function searchFunctions(query: string, category = "All"): FunctionInfo[] {
  const q = query.trim().toLowerCase();
  let list = functionCatalog();
  if (category === "Most used") {
    list = MOST_USED.map((n) => findFunction(n)!).filter(Boolean);
  } else if (category !== "All") {
    list = list.filter((f) => f.category === category);
  }
  if (!q) return list;
  const starts = list.filter((f) => f.name.toLowerCase().startsWith(q));
  const inName = list.filter((f) => !f.name.toLowerCase().startsWith(q) && f.name.toLowerCase().includes(q));
  const inDesc = list.filter((f) => !f.name.toLowerCase().includes(q) && f.description.toLowerCase().includes(q));
  return [...starts, ...inName, ...inDesc];
}
