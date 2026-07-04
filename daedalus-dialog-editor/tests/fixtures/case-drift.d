func void B_CaseDrift()
{
	b_beklauen ();
	C_Beklauen (25, 50);
};

instance dia_case (C_INFO)
{
	npc = Some_NPC;
	nr = 1;
	condition = DIA_Case_Condition;
	information = DIA_Case_Info;
};

func int DIA_Case_Condition()
{
	return TRUE;
};

func void DIA_Case_Info()
{
	AI_Output (self, other, "DIA_Case_15_00");
};
