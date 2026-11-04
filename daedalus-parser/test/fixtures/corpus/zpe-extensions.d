// #392: zParserExtender (zPE) extensions are carried verbatim, never modelled.
META
{
	Parser = Game
	MergeMode = TRUE
};

const string ZPE_Name = "zPE";

FUNC VOID ZPE_Init ()
{
	ZPE_Init_Old();
};

test ZPE_Light_Init
{
	INSTANCE ZPE_Light_Old (C_PARTICLEFX) {
		ZPE_Light_Old_Call();
		vistexcolorstart_s = "0";
	};
};

test ZPE_Empty
{
};

namespace ZPE_Demo
{
	const int ZPE_INNER = 1;
};

namespace ZPE_Bare;

FUNC VOID ZPE_After ()
{
};
