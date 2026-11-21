pragma circom 2.0.0;

include "age-threshold.circom";

component main {public [currentDate]} = AgeThreshold(18);
