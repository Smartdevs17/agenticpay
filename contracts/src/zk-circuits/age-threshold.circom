pragma circom 2.0.0;

include "circomlib/comparators.circom";

/**
 * Proves the holder meets a minimum age threshold without revealing birth date.
 * Dates are YYYYMMDD integers.
 */
template AgeThreshold(minAge) {
    signal input birthDate;
    signal input currentDate;
    signal output isValid;

    signal birthYear <== birthDate / 10000;
    signal currentYear <== currentDate / 10000;
    signal ageYears <== currentYear - birthYear;

    component ageCheck = GreaterEqThan(32);
    ageCheck.in[0] <== ageYears;
    ageCheck.in[1] <== minAge;

    isValid <== ageCheck.out;
}
