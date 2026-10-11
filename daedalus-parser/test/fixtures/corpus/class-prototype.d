class C_MyRecord
{
	var int data;
	var string label;
};

prototype Mst_Default (C_MyRecord)
{
	data = 0;
	label = "default";
};

instance Rec_First (C_MyRecord)
{
	data = 1;
	label = "first";
};
