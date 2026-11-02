// #440: a CRLF file is written back with CRLF.
const int CRLF_Value = 1;

func void DIA_Crlf_Info()
{
	AI_StopProcessInfos (self);
};

instance DIA_Crlf (C_INFO)
{
	npc = self;
	nr = 1;
	information = DIA_Crlf_Info;
};
