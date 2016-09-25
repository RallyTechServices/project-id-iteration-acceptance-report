Ext.define('CA.technicalservices.ArtifactDisplayDialog',{
    extend: 'Rally.ui.dialog.Dialog',
    alias: 'widget.tsartifactdisplaydialog',
    
    config: {
        autoShow  : true,
        closable  : true,
        layout    : 'fit',
        artifacts : []
    },
    
    constructor: function(config) {
        this.mergeConfig(config);

        this.callParent([this.config]);
    },
    
    beforeRender: function() {
        this.callParent(arguments);

        this.addDocked({
            xtype: 'toolbar',
            dock: 'bottom',
            padding: '0 0 10 0',
            layout: {
                type: 'hbox',
                pack: 'center'
            },
            ui: 'footer',
            items: [
                {
                    xtype: 'rallybutton',
                    text: 'Done',
                    cls: 'secondary rly-small',
                    handler: this.close,
                    scope: this,
                    ui: 'link'
                }
            ]
        });

        this.buildGrid();
    },
    
    buildGrid: function() {
        this.add({
            xtype                : 'rallygrid',
            showPagingToolbar    : false,
            disableSelection     : true,
            showRowActionsColumn : false,
            columnCfgs           : this._getColumns(),
            store                : Ext.create('Rally.data.custom.Store', {
                data     : this.artifacts,
                pageSize : 10000
            })
        });
    },
    
    _getColumns: function() {
        return [
            {dataIndex:'FormattedID', text:'id'},
            {dataIndex:'Name', text:'Name', flex: 1 },
            {dataIndex:'ScheduleState', text: 'State' },
            {dataIndex:'PlanEstimate', text:'Plan Estimate' },
            {dataIndex:'Iteration', text:'Iteration', width: 200, renderer: function(v) {
                if ( Ext.isEmpty(v)  ) {
                    return '--';
                 }
                 if ( Ext.isFunction(v.getData) ) { v = v.getData(); }
                 if ( Ext.isDate(v.EndDate) ) { v.EndDate = Rally.util.DateTime.toIsoString(v.EndDate); }
                 
                 return Ext.String.format("{0} (ended: {1})",  v.Name, v.EndDate.replace(/T.*$/,""));
            }},
            {dataIndex:'Project', text: 'Project', width: 200, renderer: function(v) {
                return v.Name;
            }},
            {dataIndex:'Workspace', text: 'Workspace', width: 200, renderer: function(v) {
                return v.Name;
            }}
         ];
    }

});