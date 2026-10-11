INSTANCE DIA_Broken_Test(C_INFO)
{
	npc = PC_Broken_NPC;
	nr = 1;
	condition = DIA_Broken_Test_Condition;
	information = DIA_Broken_Test_Info;
};

FUNC INT DIA_Broken_Test_Condition()
{
	return TRUE;
};

FUNC VOID DIA_Broken_Test_Info()
{
	AI_Output(self, other, "DIA_Broken_Test_15_00" //missing closing paren and semicolon
	Npc_SetRefuseTalk(self, ;;;
};
