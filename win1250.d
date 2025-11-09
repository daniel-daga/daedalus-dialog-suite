// ************************************************************
//					EntscheidungKillAlchemist
// ************************************************************

INSTANCE DIA_Arog_EntscheidungKillAlchemist(C_INFO)
{
	npc	= SLD_99005_Arog;
	nr	= 2;
	condition	= DIA_Arog_EntscheidungKillAlchemist_Condition;
	information	= DIA_Arog_EntscheidungKillAlchemist_Info;
	important	= TRUE;
};

FUNC INT DIA_Arog_EntscheidungKillAlchemist_Condition()
{
	if (Npc_KnowsInfo(self, TEST))
	{
		return TRUE;
	};
};

FUNC VOID DIA_Arog_EntscheidungKillAlchemist_Info()
{
	AI_Output(self, other, "DIA_Arog_EntscheidungKillAlchemist_15_6"); //Du hast ihn einfach umgebracht... Er ist tot. Wir müssen sofort hier weg.
	AI_Output(other, other, "DIA_Arog_EntscheidungKillAlchemist_5_6"); //Viel Glück. Du Knödel. Knööödel...... Ja du knödel!
	AI_Output(self, other, "action_1762379701358_vj2uugnzi"); //Yesy yes
	Npc_SetRefuseTalk (self, 1000);
	AI_StopProcessInfos	(self);
};
