// #440: two declarations sharing a source line stay on that line.
const int SL_A = 1; const int SL_B = 2;
const int SL_C = 3;
var int SL_D; var int SL_E;
