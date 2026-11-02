// #440: a blank line inside a C_INFO property list is write-resident.
instance DIA_Gap (C_INFO)
{
	npc = self;

	nr = 1;
	condition = DIA_Gap_Condition;
	information = DIA_Gap_Info;
};

func int DIA_Gap_Condition()
{
	return TRUE;
};

func void DIA_Gap_Info()
{
};
