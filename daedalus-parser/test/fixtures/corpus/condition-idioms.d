func int DIA_Foo_Condition()
{
	// gate on prior knowledge of the topic
	if (Npc_KnowsInfo (other, DIA_Foo))
	{
		return TRUE;
	};
	return FALSE;
};

func int DIA_Bar_Condition()
{
	var int ok;
	ok = FALSE;
	if ((hero.guild == GIL_NONE) && (Npc_GetTrueGuild (self) == GIL_MIL))
	{
		ok = TRUE;
	};
	return ok;
};

func int DIA_Baz_Condition()
{
	// the chain gate: the topic has not been heard yet
	if (!Npc_KnowsInfo (other, DIA_Foo))
	{
		return TRUE;
	};
};

func int DIA_Qux_Condition()
{
	// the same chain gate spelled as a comparison
	if (Npc_KnowsInfo (other, DIA_Foo) == FALSE)
	{
		return TRUE;
	};
};
