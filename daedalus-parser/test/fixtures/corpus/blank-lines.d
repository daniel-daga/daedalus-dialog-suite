// #286: blank lines between top-level declarations are kept as written —
// zero, one or several, before each kind, with and without leading comments.
const int BL_A = 1;
const int BL_B = 2;

const int BL_C = 3;


var int BL_D;
var int BL_E;
CLASS BL_Class
{
	var int x;
};

PROTOTYPE BL_Proto (BL_Class)
{
	x = 1;
};
INSTANCE BL_Npc_1 (BL_Proto)
{
	x = 2;
};

INSTANCE BL_Npc_2 (BL_Proto)
{
	x = 3;
};


// comment above an instance, after two blank lines
INSTANCE BL_Npc_3 (BL_Proto)
{
	x = 4;
};
INSTANCE DIA_BL_Hello (C_INFO)
{
	npc = BL_Npc_1;
	nr = 1;
	condition = DIA_BL_Hello_Condition;
	information = DIA_BL_Hello_Info;
};
FUNC INT DIA_BL_Hello_Condition ()
{
	return TRUE;
};



FUNC VOID DIA_BL_Hello_Info ()
{
};

// comment above a function
FUNC VOID BL_F ()
{
};
const int BL_After_Func = 5;

// a comment block with a gap inside it

// and a blank line before its declaration

const int BL_Spaced = 6;

// the same before a function

FUNC VOID BL_G ()
{
};
