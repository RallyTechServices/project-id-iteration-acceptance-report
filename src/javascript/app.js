Ext.define("TSProjectStatus", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    
    layout: { type: 'border' }, 
    
    items: [
        {xtype:'container',itemId:'selector_box', region: 'north', layout: { type: 'hbox' }},
        {xtype:'container',itemId:'display_box', region: 'center', layout: { type: 'fit' } }
    ],
        
    launch: function() {
        var me = this;
        this.setLoading("Loading...");

        Deft.Chain.pipeline([
            this._getMostRecentIterationForEachProject,
            this._getStoriesFromIterations
        ],this).then({
            scope: this,
            success: function(results) {
                var stories = Ext.Array.flatten(results);
                
                var stories_by_epmsid = this._organizeStoriesByEPMS(stories);
                this.logger.log('stories_by_epmsid', stories_by_epmsid);
                
                var rows = this._makeEPMSRow(stories_by_epmsid);
                this.logger.log(rows);
                
                this._displayGrid(rows);
                this.setLoading(false);
                this._addSelectors(this.down('#selector_box'));
                
            },
            failure: function(error_message){
                this.setLoading(false);
                Ext.Msg.alert('Problem loading data',error_message);
            }
        });
    },
    
    _addSelectors: function(container) {
        container.removeAll();
        
        
        var spacer = container.add({ xtype: 'container', flex: 1});
        
        container.add({
            xtype:'rallybutton',
            itemId:'export_button',
            text: '<span class="icon-export"> </span>',
            disabled: false,
            listeners: {
                scope: this,
                click: function() {
                    this._export();
                }
            }
        });
    },
    
    _getStoriesFromIterations: function(iterations_by_project_oid) {
        var deferred = Ext.create('Deft.Deferred');
        
        var me = this;
        var iterations =  Ext.Object.getValues(iterations_by_project_oid);
        var filter_array = Ext.Array.map(iterations, function(iteration) {
            return { property:'Iteration.ObjectID', value: iteration.get('ObjectID') };
        });
        
        this.logger.log("# of iterations to fetch stories for:", filter_array.length);
        
        var chunk_size = 100;
        var array_of_filters = [];
        while (filter_array.length > 0) {
            array_of_filters.push(filter_array.splice(0, chunk_size));
        }
        
        var promises = [];
        Ext.Array.each(array_of_filters,function(filters) {
            promises.push( function() {
                var config = {
                    filters: Rally.data.wsapi.Filter.or(filters),
                    model  : 'HierarchicalRequirement',
                    limit  : Infinity,
                    fetch: ['FormattedID', 'Iteration','Name','ObjectID','PlanEstimate','EndDate','Project','ScheduleState','Feature','Parent'],
                    context: { project: null }
                };
                return me._loadRecordsWithAPromise(config);
            });
        });
        
        Deft.Chain.sequence(promises,this).then({
            success: function(stories) {
                deferred.resolve(stories);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        return deferred.promise;
        
    },
    
    _getStoriesFromSixMonths: function() {
        var today = new Date();
        var today_iso = Rally.util.DateTime.toIsoString(today);
        var six_months_ago = Rally.util.DateTime.add(today,'month', -6);
        var six_months_ago_iso = Rally.util.DateTime.toIsoString(six_months_ago);
        
        var store_config = {
            model:'HierarchicalRequirement',
            fetch: ['FormattedID', 'Iteration','Name','ObjectID','PlanEstimate','EndDate','Project','ScheduleState','Feature','Parent'],
            context: { project: null },
            filters: [
                { property:'Iteration.EndDate', operator: '<', value: today_iso },
                { property:'Iteration.EndDate', operator: '>', value: six_months_ago_iso }
            ],
            limit: Infinity
        }
        
        return this._loadRecordsWithAPromise(store_config);
    },
    
    _getMostRecentIterationForEachProject: function() {
        var deferred = Ext.create('Deft.Deferred');
        
        var today = new Date();
        var today_iso = Rally.util.DateTime.toIsoString(today);
        var six_months_ago = Rally.util.DateTime.add(today,'month', -6);
        var six_months_ago_iso = Rally.util.DateTime.toIsoString(six_months_ago);
        
        var store_config = {
            model:'Iteration',
            fetch: ['Name','ObjectID','EndDate','Project'],
            context: { project: null },
            filters: [
                { property:'EndDate', operator: '<', value: today_iso },
                { property:'EndDate', operator: '>', value: six_months_ago_iso }
            ],
            limit: Infinity
        }
        
        this._loadRecordsWithAPromise(store_config).then({
            success: function(iterations) {
                var last_iteration_by_project_oid = {};
                Ext.Array.each(iterations, function(iteration){
                    var project_oid = iteration.get('Project').ObjectID;
                    var end_date = iteration.get('EndDate');
                    if ( !last_iteration_by_project_oid[project_oid] ) {
                        last_iteration_by_project_oid[project_oid] = iteration;
                    } else {
                        var last_iteration_end = last_iteration_by_project_oid[project_oid].get('EndDate');
                        if ( end_date > last_iteration_end ) {
                            last_iteration_by_project_oid[project_oid] = iteration;
                        }
                    }
                });
                deferred.resolve(last_iteration_by_project_oid);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        return deferred.promise;
    },
    
    _organizeStoriesByEPMS: function(stories) {
        var stories_by_epms = {};
        Ext.Array.each(stories, function(story){
            var epms_id = this._getEPMSIdFromStory(story);
            if ( epms_id == null ) { 
                epms_id = "-- NONE -- ";
            }
            if ( !stories_by_epms[epms_id] ) {
                stories_by_epms[epms_id] = [];
            }
            stories_by_epms[epms_id].push(story);
        },this);
        return stories_by_epms;
    },
    
    /*
     * if project name contains six digit decimal starting with 10,
     * then use the project name,
     * otherwise, see if the PI has an EPMS ID
     */ 
    _getEPMSIdFromStory: function(story) {
        var project = story.get('Project');
        
        if ( /10\d\d\d\d/.test(project.Name) ) {
            return /(10\d\d\d\d)/.exec(project.Name)[1];
        }
        
        var feature = story.get('Feature');
        if ( feature && feature.Parent ) {
            
            if ( /10\d\d\d\d/.test(feature.Parent.Name) ) {
                return /(10\d\d\d\d)/.exec(feature.Parent.Name)[1];
            }
            
        }
        
        return null;
    },

    _loadRecordsWithAPromise: function(store_config){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        this.logger.log("Starting load:",store_config);
        
        var default_config = {
            autoLoad: false
        };
        
        Ext.create('Rally.data.wsapi.Store', Ext.apply({},store_config)).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },
    
    _makeEPMSRow: function(stories_by_epmsid){
        var rows = [];
        Ext.Object.each(stories_by_epmsid, function(id,stories)  {
            var total = Ext.Array.sum ( Ext.Array.map(stories, function(story) {
                return story.get('PlanEstimate') || 0;
            }));
            
            var accepted_total = Ext.Array.sum ( Ext.Array.map(stories, function(story) {
                if ( story.get('ScheduleState') == "Accepted" ) {
                    return story.get('PlanEstimate') || 0;
                } 
                return 0;
            }));
            
            var accepted_percent = -1;
            if ( total > 0 ) {
                accepted_percent = accepted_total / total;
            }
            rows.push({
                id: id,
                total: total,
                accepted_total: accepted_total,
                accepted_percent: accepted_percent,
                stories: stories
            });
        });
        return rows;
    },
    
    _displayGrid: function(rows){
        var store = Ext.create('Rally.data.custom.Store',{ data: rows });
        
        this.down('#display_box').add({
            xtype: 'rallygrid',
            store: store,
            showPagingToolbar: false,
            columnCfgs: [
                { dataIndex: 'id', text: 'EPMS ID' },
                { dataIndex: 'total', text: 'Total (Plan&nbsp;Estimate)' },
                { dataIndex: 'accepted_total', text: 'Accepted (Plan&nbsp;Estimate)' },
                { dataIndex: 'accepted_percent', text: 'Accepted Percentage', renderer: function(v) {
                    if ( v < 0 ) {
                        return "N/A";
                    }
                    return Ext.util.Format.number(v*100,'0.0') + '%';
                }}
            ],
            listeners: {
                scope: this,
                itemclick: function(grid, record, item, index, evt) {
                    this._displayPopupForStories("Items for Project " + record.get('id'), record.get('stories'));
                }
            }
        });
    },
    
    _displayPopupForStories: function(title,stories) {
        Ext.create('Rally.ui.dialog.Dialog', {
            id       : 'popup',
            width    : Ext.getBody().getWidth() - 20,
            height   : Ext.getBody().getHeight() - 20,
            title    : title,
            autoShow : true,
            closable : true,
            layout   : 'fit',
            items    : [{
                xtype                : 'rallygrid',
                id                   : 'popupGrid',
                showPagingToolbar    : false,
                disableSelection     : true,
                showRowActionsColumn : false,
                columnCfgs           : [
                    {dataIndex:'FormattedID', text:'id'},
                    {dataIndex:'Name', text:'Name', flex: 1 },
                    {dataIndex:'ScheduleState', text: 'State' },
                    {dataIndex:'PlanEstimate', text:'Plan Estimate' },
                    {dataIndex:'Iteration', text:'Iteration', width: 200, renderer: function(v) {
                        if ( Ext.isEmpty(v)  ) {
                            return '--';
                        }
                        return Ext.String.format("{0} (ended: {1})",  v.Name, v.EndDate.replace(/T.*$/,""));
                    }},
                    {dataIndex:'Project', text: 'Project', width: 200, renderer: function(v) {
                        return v.Name;
                    }}
                ],
                store                : Ext.create('Rally.data.custom.Store', {
                    data     : stories,
                    pageSize : 10000
                })
            }]
        });
    },
    
    _export: function(){
        var grid = this.down('rallygrid');
        var me = this;
        
        if ( !grid ) { return; }
        
        this.logger.log('_export',grid);

        var filename = Ext.String.format('project-report.csv');

        this.setLoading("Generating CSV");
        Deft.Chain.sequence([
            function() { return Rally.technicalservices.FileUtilities.getCSVFromGrid(this,grid) } 
        ]).then({
            scope: this,
            success: function(csv){
                if (csv && csv.length > 0){
                    Rally.technicalservices.FileUtilities.saveCSVToFile(csv,filename);
                } else {
                    Rally.ui.notify.Notifier.showWarning({message: 'No data to export'});
                }
                
            }
        }).always(function() { me.setLoading(false); });
    },
    
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        // Ext.apply(this, settings);
        this.launch();
    }
});
