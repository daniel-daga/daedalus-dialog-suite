INSTANCE DIA_Umlaut_Greet(C_INFO)
{
	npc = PC_Umlaut_NPC;
	nr = 1;
	condition = DIA_Umlaut_Greet_Condition;
	information = DIA_Umlaut_Greet_Info;
	important = TRUE;
};

FUNC INT DIA_Umlaut_Greet_Condition()
{
	return TRUE;
};

FUNC VOID DIA_Umlaut_Greet_Info()
{
	AI_Output(self, other, "DIA_Umlaut_Greet_15_00"); //Willkommen, Fremder. Über Änderungen später.
	AI_Output(self, other, "DIA_Umlaut_Greet_15_01"); //Schöne Grüße, Söldner!
};
