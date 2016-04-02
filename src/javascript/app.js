Ext.define("TSProjectStatus", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    
    layout: { type: 'border' }, 
    
    config: {
        defaultSettings: {
            showAllWorkspaces: false
        }
    },
    
    items: [
        {xtype:'container',itemId:'selector_box', region: 'north', layout: { type: 'hbox' }},
        {xtype:'container',itemId:'display_box', region: 'center', layout: { type: 'fit' } }
    ],
        
    launch: function() {
        var me = this;
        this.setLoading("Loading...");
        
        this._getWorkspaces().then({
            scope: this,
            success: function(workspaces) {
                var promises = Ext.Array.map(workspaces, function(workspace) {
                    return function() { 
                        return me._getData( workspace.get('Name'), workspace.get('ObjectID') ) 
                    };
                });
                
                Deft.Chain.sequence(promises).then({
                    scope: this,
                    success: function(array_of_rows_by_epmsid) {
                        var consolidated_rows_by_epmsid = {};
                        // we got an array of hashes because epms id might have been
                        // valid in more than one WS (or at least 'NONE' is)
                        Ext.Array.each(array_of_rows_by_epmsid, function(row_hash) {
                            Ext.Object.each( row_hash, function(epmsid, row) {
                                if ( Ext.isEmpty(consolidated_rows_by_epmsid[epmsid])) {
                                    consolidated_rows_by_epmsid[epmsid] = row;
                                } else {
                                    var old_total = consolidated_rows_by_epmsid[epmsid].total;
                                    var adding_total = row.total;
                                    consolidated_rows_by_epmsid[epmsid].total = old_total + adding_total;
                                    
                                    var old_accepted = consolidated_rows_by_epmsid[epmsid].accepted_total;
                                    var adding_accepted= row.accepted_total;
                                    consolidated_rows_by_epmsid[epmsid].accepted_total = old_accepted + adding_accepted;

                                    consolidated_rows_by_epmsid[epmsid].accepted_percent = consolidated_rows_by_epmsid[epmsid].accepted_total / consolidated_rows_by_epmsid[epmsid].total;
                                    
                                    consolidated_rows_by_epmsid[epmsid].stories = Ext.Array.push( consolidated_rows_by_epmsid[epmsid].stories, row.stories);
                                }
                            });
                            
                        });
                        
                        var rows = Ext.Object.getValues(consolidated_rows_by_epmsid);
                        this._displayGrid(Ext.Array.flatten(rows));
                        this._addSelectors(this.down('#selector_box'));
                    },
                    failure: function(msg) {
                        Ext.Msg.alert('Problem gathering data', msg);
                    }
                });
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem loading workspaces', msg);
            }
        });

    },
    
    _getWorkspaces: function() {
        var deferred = Ext.create('Deft.Deferred');
        var config = {
            model: 'Subscription',
            fetch: ['ObjectID','Workspaces']
        };
        
        this._loadRecordsWithAPromise(config).then({
            scope: this,
            success: function(subs) {
                var sub = subs[0];
                sub.getCollection('Workspaces').load({
                    fetch: ['ObjectID','Name','State'],
                    sorters: [{property:'Name'}],
                    callback: function(workspaces,operation,success){
                        
                        var open_workspaces = Ext.Array.filter(workspaces, function(ws) {
                            if ( Rally.getApp().getSetting('showAllWorkspaces') == false ) {
                                return ( ws.get('ObjectID') == Rally.getApp().getContext().getWorkspace().ObjectID );
                            }
                            
                            return ( ws.get('State') == "Open" ) ;
                        });
                        deferred.resolve(open_workspaces);
                    }
                });
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        return deferred.promise;
    },
    
    _getData: function(workspace_name, workspace_oid) {
        var deferred = Ext.create('Deft.Deferred');
        
        this.setLoading('Loading Workspace ' + workspace_name);
        
        Deft.Chain.pipeline([
            function() { return this._getMostRecentIterationForEachProject(workspace_oid) },
            function(iterations) { return this._getScheduledItemsFromIterations(iterations,workspace_oid) }
        ],this).then({
            scope: this,
            success: function(stories) {
                var non_archived_stories = Ext.Array.filter(stories, function(story){
                    
                    var feature = story.get('Feature');
                    if ( feature && feature.Parent ) {
                        if ( feature.Parent.Archived == true ) { 
                            return false;
                        }
                    }
                    return true;
                });
                
                var stories_by_epmsid = this._organizeStoriesByEPMS(non_archived_stories);
                this.logger.log('stories_by_epmsid', stories_by_epmsid);
                
                var rows = this._makeEPMSRow(stories_by_epmsid);
                
                var rows_by_epmsid = {};
                Ext.Array.each(rows, function(row) {
                    rows_by_epmsid[row.id] = row;
                });
                this.setLoading(false);
                deferred.resolve(rows_by_epmsid);
            },
            failure: function(error_message){
                deferred.reject(error_message);
            }
        });
        
        return deferred.promise;
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
    
    _getScheduledItemsFromIterations: function(iterations_by_project_oid, workspace_oid) {
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
            
            var archived_filters = Rally.data.wsapi.Filter.and([
                {property:'Project.Name',operator:'!contains', value:'Archive'},
                {property:'Project.Parent.Name',operator:'!contains', value:'Archive'}
            ]);
            
            var schedulable_model_names = ['HierarchicalRequirement','Defect','TestSet','DefectSuite'];
            
            Ext.Array.each(schedulable_model_names,function(model_name){
                promises.push( function() {
                    var config = {
                        filters: Rally.data.wsapi.Filter.or(filters).and(archived_filters),
                        model  : model_name,
                        limit  : Infinity,
                        sorters: [ {property:'DragAndDropRank', direction:'ASC'}],
                        fetch: ['FormattedID','Iteration','StartDate', 'EndDate',
                            'Name','ObjectID','PlanEstimate','AcceptedDate','Archived',
                            'Project','ScheduleState','Feature','Parent','Workspace', 'c_EPMSid'],
                        context: { 
                            project: null,
                            workspace: '/workspace/' + workspace_oid
                        }
                    };
                    return me._loadRecordsWithAPromise(config);
                });
            });
            
        });
        
        Deft.Chain.sequence(promises,this).then({
            scope: this,
            success: function(results) {
                var stories = Ext.Array.flatten(results);

                var iterations_without_stories = this._replaceIterationsWithoutStories(iterations, stories);
                deferred.resolve(Ext.Array.merge(stories,iterations_without_stories));
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        return deferred.promise;
        
    },
    
    _replaceIterationsWithoutStories: function(iterations, stories){
        this.logger.log('_replaceIterationsWithoutStories', iterations, stories);
        var iterations_that_have_stories = Ext.Array.map(stories, function(story){
            return story.get('Iteration').ObjectID;
        });
        
        var placeholder_stories = [];
        Ext.Array.each(iterations, function(iteration) {
            if ( !Ext.Array.contains(iterations_that_have_stories, iteration.get('ObjectID') ) )  {
                var fake_story = Ext.create('FakeStory',{
                    ObjectID: '-1',
                    PlanEstimate: 0, 
                    Iteration: iteration.getData(),
                    Project: iteration.get('Project'),
                    Workspace: iteration.get('Workspace')
                });
//                
                placeholder_stories.push(fake_story);
            }
        });
        this.logger.log('No stories:', placeholder_stories);
        return placeholder_stories;
    },
    
    _getStoriesFromSixMonths: function() {
        var today = new Date();
        var today_iso = Rally.util.DateTime.toIsoString(today);
        var six_months_ago = Rally.util.DateTime.add(today,'month', -6);
        var six_months_ago_iso = Rally.util.DateTime.toIsoString(six_months_ago);
        
        var store_config = {
            model:'HierarchicalRequirement',
            fetch: ['FormattedID', 'Iteration','EndDate','StartDate','Name','ObjectID','PlanEstimate',
                'Project','AcceptedDate','ScheduleState','Feature','Parent','c_EPMSid'],
            context: { project: null },
            filters: [
                { property:'Iteration.EndDate', operator: '<', value: today_iso },
                { property:'Iteration.EndDate', operator: '>', value: six_months_ago_iso }
            ],
            limit: Infinity
        }
        
        return this._loadRecordsWithAPromise(store_config);
    },
    
    _getMostRecentIterationForEachProject: function(workspace_oid) {
        var deferred = Ext.create('Deft.Deferred');
        
        var today = new Date();
        var today_iso = Rally.util.DateTime.toIsoString(today);
        var six_months_ago = Rally.util.DateTime.add(today,'month', -6);
        var six_months_ago_iso = Rally.util.DateTime.toIsoString(six_months_ago);
        
        var store_config = {
            model:'Iteration',
            fetch: ['Name','ObjectID','EndDate','Project','Workspace','StartDate'],
            context: { 
                project: null,
                workspace: '/workspace/' + workspace_oid
            },
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
            story = this._getEPMSIdFromStory(story);
            var epms_id = story.get('epms_id');

            if ( !stories_by_epms[epms_id] ) {
                stories_by_epms[epms_id] = [];
            }
            stories_by_epms[epms_id].push(story);
        },this);
        return stories_by_epms;
    },
    
    /*
     * If the PI has an EPMIS ID, use that, otherwise,
     * if project name contains six digit decimal starting with 10,
     * then use the project name
     */ 
    _getEPMSIdFromStory: function(story) {
        var project = story.get('Project');
        
        story.set('epms_source','none');
        
        var feature = story.get('Feature');

        if ( feature && feature.Parent && feature.Parent.c_EPMSid) {
            
            story.set('epms_id', feature.Parent.c_EPMSid);
            story.set('epms_source', 'epms project');
            
//            if ( /10\d\d\d\d/.test(feature.Parent.Name) ) {
//                story.set('epms_id', /(10\d\d\d\d)/.exec(feature.Parent.Name)[1] );
//                story.set('epms_source', 'feature');
//                return story;
//            }
            return story;
//            
        }
        
        if ( /10\d\d\d\d/.test(project.Name) ) {
            story.set('epms_id', /(10\d\d\d\d)/.exec(project.Name)[1] );
            story.set('epms_source', 'project');
            return story;
        }
        
        story.set('epms_id', '-- NONE --');
        return story;
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
            var iteration_name = "";
            var project_space = "";
            var iteration_start = "";
            var iteration_end = "";
            var workspace_name = "Multiple";

            Ext.Array.each(stories, function(story) {
                
                if ( story.get('Iteration') ) { 
                    iteration_name =  story.get('Iteration').Name;
                    iteration_start = Rally.util.DateTime.fromIsoString( story.get('Iteration').StartDate );
                    iteration_end =   Rally.util.DateTime.fromIsoString( story.get('Iteration').EndDate );
                }
                if ( story.get('Workspace') ) {
                    workspace_name = story.get('Workspace').Name;
                }
                
                if ( story.get('epms_source') == 'project' && story.get('Project') ) {
                    project_space = story.get('Project').Name;
                } else if ( story.get('epms_source') == 'feature' ) {
                    var feature = story.get('Feature');
                    if ( feature ) {
                        project_space = feature.Project.Name;
                    }
                }
            });
            
            var total = Ext.Array.sum ( Ext.Array.map(stories, function(story) {
                return story.get('PlanEstimate') || 0;
            }));
            
            var accepted_total = Ext.Array.sum ( Ext.Array.map(stories, function(story) {
                if ( !Ext.isEmpty( story.get('AcceptedDate') ) ) {
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
                stories: stories,
                iteration_name: iteration_name,
                iteration_start: iteration_start,
                iteration_end: iteration_end,
                workspace: workspace_name,
                project_space: project_space
            });
        });
        return rows;
    },
    
    _displayGrid: function(rows){
        var store = Ext.create('Rally.data.custom.Store',{ 
            data: rows,
            pageSize: 5000
        });
        this.down('#display_box').removeAll();
        
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
                }},
                { dataIndex: 'iteration_name', text: 'Iteration', renderer: function(v, meta, record) {
                    if ( Ext.isEmpty(v) ) { return "--"; }
                    if ( record.get('id') == "-- NONE -- " ) {
                        return "N/A";
                    }
                    return v;
                } },
                { dataIndex: 'iteration_start', text: 'Start' , renderer: function(v, meta, record) {
                    if ( Ext.isEmpty(v) ) { return "--"; }
                    if ( record.get('id') == "-- NONE -- " ) {
                        return "N/A";
                    }
                    return Ext.util.Format.date(v,"m/d/Y");
                }},
                { dataIndex: 'iteration_end', text: 'End' , renderer: function(v, meta, record) {
                    if ( Ext.isEmpty(v) ) { return "--"; }
                    if ( record.get('id') == "-- NONE -- " ) {
                        return "N/A";
                    }
                    return Ext.util.Format.date(v,"m/d/Y");
                }},
                { dataIndex: 'project_space', text: 'Project' },
                { dataIndex: 'workspace', text: 'Workspace', renderer: function(value, meta, record) {
                    if ( record.get('id') == "-- NONE -- " ) {
                        return "N/A";
                    }
                    
                    return value;
                } }
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
                    }},
                    {dataIndex:'Workspace', text: 'Workspace', width: 200, renderer: function(v) {
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
    },
    
    getSettingsFields: function() {
        var me = this;
        
        return [{
            name: 'showAllWorkspaces',
            xtype: 'rallycheckboxfield',
            fieldLabel: 'Show All Workspaces',
            labelWidth: 135,
            labelAlign: 'left',
            minWidth: 200,
            margin: 10
        }];
    }
});
