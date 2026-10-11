func void DIA_Order_Info()
{
	AI_Output (self, other, "DIA_Order_15_00");
};

func int DIA_Order_Condition()
{
	return TRUE;
};

instance DIA_Order (C_INFO)
{
	npc = Some_NPC;
	nr = 1;
	condition = DIA_Order_Condition;
	information = DIA_Order_Info;
};
