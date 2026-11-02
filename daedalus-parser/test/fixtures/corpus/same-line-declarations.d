// #440: two declarations sharing a source line stay on that line.
const int SL_A = 1; const int SL_B = 2;
const int SL_C = 3;
var int SL_D; var int SL_E;
// #397: the text between them is kept, not normalized to one space.
const int SL_F = 1;	var int SL_G;
// #397: a sibling after a multi-line declaration's closing `};` stays there.
class SL_H
{
	var int a;
}; class SL_I
{
	var int b;
};
instance SL_J(C_NPC)
{
	name = "j";
}; instance SL_K(NPC_DEFAULT);
